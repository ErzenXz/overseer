package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/overseer-sh/overseer/internal/protocol"
)

// agentConn is one live device connection on the hub side.
type agentConn struct {
	deviceId string
	hello    protocol.Hello
	ws       *websocket.Conn

	writeMu sync.Mutex

	mu       sync.Mutex
	pending  map[uint64]chan protocol.Msg
	channels map[uint32]*hubChannel
	stats    *protocol.Stats
	closed   bool

	nextId      atomic.Uint64
	nextChannel atomic.Uint32
}

// hubChannel receives one stream's traffic from the agent.
type hubChannel struct {
	onBinary  func([]byte)
	onControl func(protocol.Msg)
}

func newAgentConn(deviceId string, hello protocol.Hello, ws *websocket.Conn) *agentConn {
	return &agentConn{
		deviceId: deviceId,
		hello:    hello,
		ws:       ws,
		pending:  map[uint64]chan protocol.Msg{},
		channels: map[uint32]*hubChannel{},
	}
}

func (c *agentConn) sendJSON(m protocol.Msg) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.WriteJSON(m)
}

func (c *agentConn) sendBinary(channel uint32, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.WriteMessage(websocket.BinaryMessage, protocol.EncodeFrame(channel, payload))
}

// request sends an id-carrying message and waits for the matching result.
func (c *agentConn) request(ctx context.Context, typ string, v any) (protocol.Msg, error) {
	id := c.nextId.Add(1)
	m, err := protocol.NewMsg(typ, id, 0, v)
	if err != nil {
		return protocol.Msg{}, err
	}
	ch := make(chan protocol.Msg, 1)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return protocol.Msg{}, fmt.Errorf("device disconnected")
	}
	c.pending[id] = ch
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
	}()

	if err := c.sendJSON(m); err != nil {
		return protocol.Msg{}, err
	}
	select {
	case reply := <-ch:
		if reply.Error != "" {
			return reply, fmt.Errorf("%s", reply.Error)
		}
		return reply, nil
	case <-ctx.Done():
		return protocol.Msg{}, ctx.Err()
	}
}

// requestInto unmarshals the reply's data into out.
func (c *agentConn) requestInto(ctx context.Context, typ string, v any, out any) error {
	reply, err := c.request(ctx, typ, v)
	if err != nil {
		return err
	}
	if out != nil && len(reply.Data) > 0 {
		return json.Unmarshal(reply.Data, out)
	}
	return nil
}

// openChannel registers a stream handler and returns its channel id.
func (c *agentConn) openChannel(h *hubChannel) uint32 {
	id := c.nextChannel.Add(1)
	c.mu.Lock()
	c.channels[id] = h
	c.mu.Unlock()
	return id
}

func (c *agentConn) closeChannel(id uint32) {
	c.mu.Lock()
	delete(c.channels, id)
	c.mu.Unlock()
}

// --- registry of connected agents ---

type registry struct {
	mu     sync.Mutex
	agents map[string]*agentConn
	events *eventBus
}

func newRegistry(events *eventBus) *registry {
	return &registry{agents: map[string]*agentConn{}, events: events}
}

func (r *registry) add(c *agentConn) {
	r.mu.Lock()
	old := r.agents[c.deviceId]
	r.agents[c.deviceId] = c
	r.mu.Unlock()
	if old != nil {
		old.ws.Close()
	}
	r.events.publish(event{Type: "device.online", DeviceId: c.deviceId})
}

func (r *registry) remove(c *agentConn) {
	r.mu.Lock()
	if r.agents[c.deviceId] == c {
		delete(r.agents, c.deviceId)
	}
	r.mu.Unlock()
	r.events.publish(event{Type: "device.offline", DeviceId: c.deviceId})
}

func (r *registry) get(deviceId string) *agentConn {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.agents[deviceId]
}

func (r *registry) all() []*agentConn {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*agentConn, 0, len(r.agents))
	for _, c := range r.agents {
		out = append(out, c)
	}
	return out
}

// serveAgent runs the read loop for one connected agent until it drops.
func (s *Server) serveAgent(c *agentConn) {
	s.registry.add(c)
	defer func() {
		c.mu.Lock()
		c.closed = true
		pending := c.pending
		c.pending = map[uint64]chan protocol.Msg{}
		channels := c.channels
		c.channels = map[uint32]*hubChannel{}
		c.mu.Unlock()
		for _, ch := range pending {
			close(ch)
		}
		exit := protocol.Msg{Type: protocol.TypeTermExit, Error: "device disconnected"}
		for _, h := range channels {
			if h.onControl != nil {
				h.onControl(exit)
			}
		}
		s.registry.remove(c)
		s.store.TouchDevice(c.deviceId)
		log.Printf("device %s disconnected", c.deviceId)
	}()

	c.ws.SetReadLimit(16 * 1024 * 1024)
	for {
		msgType, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		switch msgType {
		case websocket.TextMessage:
			var m protocol.Msg
			if err := json.Unmarshal(data, &m); err != nil {
				continue
			}
			s.handleAgentMsg(c, m)
		case websocket.BinaryMessage:
			ch, payload, err := protocol.DecodeFrame(data)
			if err != nil {
				continue
			}
			c.mu.Lock()
			h := c.channels[ch]
			c.mu.Unlock()
			if h != nil && h.onBinary != nil {
				h.onBinary(payload)
			}
		}
	}
}

func (s *Server) handleAgentMsg(c *agentConn, m protocol.Msg) {
	switch {
	case m.Type == protocol.TypeResult && m.Id != 0:
		c.mu.Lock()
		ch := c.pending[m.Id]
		c.mu.Unlock()
		if ch != nil {
			select {
			case ch <- m:
			default:
			}
		}
	case m.Type == protocol.TypeStats:
		var st protocol.Stats
		if err := json.Unmarshal(m.Data, &st); err == nil {
			c.mu.Lock()
			c.stats = &st
			c.mu.Unlock()
			s.events.publish(event{Type: "device.stats", DeviceId: c.deviceId, Stats: &st})
		}
	case m.Channel != 0:
		c.mu.Lock()
		h := c.channels[m.Channel]
		c.mu.Unlock()
		if h != nil && h.onControl != nil {
			h.onControl(m)
		}
	}
}

// --- event bus (hub -> browsers) ---

type event struct {
	Type     string          `json:"type"`
	DeviceId string          `json:"deviceId,omitempty"`
	Stats    *protocol.Stats `json:"stats,omitempty"`
}

type eventBus struct {
	mu   sync.Mutex
	subs map[chan event]struct{}
}

func newEventBus() *eventBus {
	return &eventBus{subs: map[chan event]struct{}{}}
}

func (b *eventBus) subscribe() (chan event, func()) {
	ch := make(chan event, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		delete(b.subs, ch)
		b.mu.Unlock()
	}
}

func (b *eventBus) publish(e event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default: // slow subscriber: drop rather than block the hub
		}
	}
}

// deviceCtx returns a bounded context for device round-trips.
func deviceCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func contextWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}
