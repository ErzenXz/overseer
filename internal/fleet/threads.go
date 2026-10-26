package fleet

import (
	"context"
	"net/url"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent sessions ("threads"): the typed client surface behind `overseer top`
// and `overseer status`. All of these endpoints accept API tokens.

// Thread is one agent session as the hub lists it.
type Thread struct {
	Id         string          `json:"id"`
	Title      string          `json:"title"`
	DeviceId   string          `json:"deviceId"`
	DeviceName string          `json:"deviceName"`
	Agent      string          `json:"agent"`
	Cwd        string          `json:"cwd"`
	Model      string          `json:"model,omitempty"`
	Access     string          `json:"access"`
	Archived   bool            `json:"archived,omitempty"`
	Folder     string          `json:"folder,omitempty"`
	ParentId   string          `json:"parentId,omitempty"`
	Status     string          `json:"status"` // starting | working | waiting | idle | error | stopped
	Error      string          `json:"error,omitempty"`
	CreatedAt  int64           `json:"createdAt"`
	UpdatedAt  int64           `json:"updatedAt"`
	Usage      *protocol.Usage `json:"usage,omitempty"`
}

// ThreadMessage is one folded item of a session's transcript.
type ThreadMessage struct {
	Id         string                          `json:"id"`
	Seq        int64                           `json:"seq"`
	At         int64                           `json:"at"`
	UpdatedAt  int64                           `json:"updatedAt"`
	Role       string                          `json:"role"` // user assistant thought tool plan approval question error status
	Text       string                          `json:"text"`
	Queued     bool                            `json:"queued,omitempty"`
	ParentId   string                          `json:"parentId,omitempty"`
	DurationMs int64                           `json:"durationMs,omitempty"`
	Tool       *protocol.ThreadTool            `json:"tool,omitempty"`
	Plan       []protocol.PlanEntry            `json:"plan,omitempty"`
	Approval   *protocol.ThreadApprovalRequest `json:"approval,omitempty"`
	Question   *protocol.ThreadQuestion        `json:"question,omitempty"`
}

// DevicesContext is Devices with a cancellable context.
func (c *Client) DevicesContext(ctx context.Context) ([]Device, error) {
	var out []Device
	err := c.doContext(ctx, "GET", "/api/devices", nil, &out)
	return out, err
}

// Threads lists every agent session.
func (c *Client) Threads(ctx context.Context) ([]Thread, error) {
	var out []Thread
	err := c.doContext(ctx, "GET", "/api/threads", nil, &out)
	return out, err
}

// Thread returns one session with its transcript.
func (c *Client) Thread(ctx context.Context, id string) (*Thread, []ThreadMessage, error) {
	var out struct {
		Thread   Thread          `json:"thread"`
		Messages []ThreadMessage `json:"messages"`
	}
	if err := c.doContext(ctx, "GET", "/api/threads/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, nil, err
	}
	return &out.Thread, out.Messages, nil
}

// ThreadApproval answers a pending approval request with one of its options.
func (c *Client) ThreadApproval(ctx context.Context, id, approvalId, optionId string) error {
	body := map[string]string{"approvalId": approvalId, "optionId": optionId}
	return c.doContext(ctx, "POST", "/api/threads/"+url.PathEscape(id)+"/approval", body, nil)
}

// ThreadPrompt sends a message to a session (steers a running turn when the
// agent supports it, otherwise queues it).
func (c *Client) ThreadPrompt(ctx context.Context, id, text string) error {
	return c.doContext(ctx, "POST", "/api/threads/"+url.PathEscape(id)+"/prompt", map[string]string{"text": text}, nil)
}

// ThreadCancel stops the session's current turn.
func (c *Client) ThreadCancel(ctx context.Context, id string) error {
	return c.doContext(ctx, "POST", "/api/threads/"+url.PathEscape(id)+"/cancel", nil, nil)
}

// GitBranches asks a device for the git branch of each folder. Folders that
// are not repositories (or that error) are simply missing from the result.
func (c *Client) GitBranches(ctx context.Context, deviceId string, paths []string) (map[string]string, error) {
	var res protocol.GitInfoResult
	err := c.doContext(ctx, "POST", "/api/devices/"+url.PathEscape(deviceId)+"/git-info",
		protocol.GitInfoRequest{Paths: paths}, &res)
	out := map[string]string{}
	for _, p := range res.Paths {
		if p.IsRepo && p.Branch != "" {
			out[p.Path] = p.Branch
		}
	}
	return out, err
}

// HubVersion reads the hub's version from the unauthenticated /api/me.
func (c *Client) HubVersion(ctx context.Context) string {
	var me struct {
		Version string `json:"version"`
	}
	if err := c.doContext(ctx, "GET", "/api/me", nil, &me); err != nil {
		return ""
	}
	return me.Version
}
