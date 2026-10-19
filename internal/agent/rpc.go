package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
)

// rpcConn is a minimal bidirectional JSON-RPC 2.0 peer over an agent
// process's stdio. ACP uses the standard envelope; `codex app-server` omits
// the "jsonrpc" field, which withVersion=false reproduces.
type rpcConn struct {
	proc        *agentProcess
	withVersion bool

	// onNotify runs inline on the read goroutine, so notifications are seen
	// in order. onRequest runs on its own goroutine (it may block, e.g. a
	// permission prompt) and must answer with respond.
	onNotify  func(method string, params json.RawMessage)
	onRequest func(id json.RawMessage, method string, params json.RawMessage)

	mu      sync.Mutex
	nextId  int64
	pending map[int64]chan rpcMsg
	closed  bool
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string { return e.Message }

type rpcMsg struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	Id      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// rpcResult is a success response; Result is never omitted (null is valid).
type rpcResult struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	Id      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
}

type rpcErrorReply struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	Id      json.RawMessage `json:"id"`
	Error   *rpcError       `json:"error"`
}

func newRPCConn(withVersion bool) *rpcConn {
	return &rpcConn{withVersion: withVersion, pending: map[int64]chan rpcMsg{}}
}

func (c *rpcConn) version() string {
	if c.withVersion {
		return "2.0"
	}
	return ""
}

// handleLine is the agentProcess line callback.
func (c *rpcConn) handleLine(line []byte) {
	var m rpcMsg
	if err := json.Unmarshal(line, &m); err != nil {
		return
	}
	hasId := len(m.Id) > 0 && string(m.Id) != "null"
	switch {
	case m.Method != "" && hasId:
		if c.onRequest != nil {
			go c.onRequest(m.Id, m.Method, m.Params)
		} else {
			c.respondError(m.Id, -32601, "method not found: "+m.Method)
		}
	case m.Method != "":
		if c.onNotify != nil {
			c.onNotify(m.Method, m.Params)
		}
	case hasId:
		id, err := strconv.ParseInt(string(m.Id), 10, 64)
		if err != nil {
			// We only ever send numeric ids; tolerate agents that echo them
			// back as strings.
			var s string
			if json.Unmarshal(m.Id, &s) != nil {
				return
			}
			if id, err = strconv.ParseInt(s, 10, 64); err != nil {
				return
			}
		}
		c.mu.Lock()
		ch := c.pending[id]
		delete(c.pending, id)
		c.mu.Unlock()
		if ch != nil {
			ch <- m
		}
	}
}

// shutdown fails every in-flight call; called when the process exits.
func (c *rpcConn) shutdown() {
	c.mu.Lock()
	c.closed = true
	pending := c.pending
	c.pending = map[int64]chan rpcMsg{}
	c.mu.Unlock()
	for _, ch := range pending {
		close(ch)
	}
}

// call sends a request and waits for its response, decoding result into out.
func (c *rpcConn) call(ctx context.Context, method string, params any, out any) error {
	raw, err := marshalParams(params)
	if err != nil {
		return err
	}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return fmt.Errorf("agent process is not running")
	}
	c.nextId++
	id := c.nextId
	ch := make(chan rpcMsg, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	idRaw := json.RawMessage(strconv.FormatInt(id, 10))
	if err := c.proc.writeJSON(rpcMsg{JSONRPC: c.version(), Id: idRaw, Method: method, Params: raw}); err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return err
	}
	select {
	case m, ok := <-ch:
		if !ok {
			return fmt.Errorf("agent process exited during %s", method)
		}
		if m.Error != nil {
			return fmt.Errorf("%s: %s", method, m.Error.Message)
		}
		if out != nil && len(m.Result) > 0 {
			return json.Unmarshal(m.Result, out)
		}
		return nil
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return ctx.Err()
	}
}

func (c *rpcConn) notify(method string, params any) error {
	raw, err := marshalParams(params)
	if err != nil {
		return err
	}
	return c.proc.writeJSON(rpcMsg{JSONRPC: c.version(), Method: method, Params: raw})
}

func (c *rpcConn) respond(id json.RawMessage, result any) error {
	b, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return c.proc.writeJSON(rpcResult{JSONRPC: c.version(), Id: id, Result: b})
}

func (c *rpcConn) respondError(id json.RawMessage, code int, msg string) error {
	return c.proc.writeJSON(rpcErrorReply{JSONRPC: c.version(), Id: id, Error: &rpcError{Code: code, Message: msg}})
}

func marshalParams(params any) (json.RawMessage, error) {
	if params == nil {
		return nil, nil
	}
	return json.Marshal(params)
}
