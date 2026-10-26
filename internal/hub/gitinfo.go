package hub

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

const gitInfoTimeout = 12 * time.Second

// handleDeviceGitInfo reports, for each requested folder, whether it exists
// on the device and which repo and branch it is on. An offline device answers
// 503 so the caller can show "offline, last seen ..." from the device list.
func (s *Server) handleDeviceGitInfo(w http.ResponseWriter, r *http.Request) {
	var req protocol.GitInfoRequest
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.Paths) == 0 || len(req.Paths) > protocol.MaxGitInfoPaths {
		httpError(w, http.StatusBadRequest, "send between 1 and 32 paths")
		return
	}
	for _, p := range req.Paths {
		if len(p) > maxProjectPath || strings.ContainsRune(p, 0) {
			httpError(w, http.StatusBadRequest, "path is invalid")
			return
		}
	}
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := contextWithTimeout(gitInfoTimeout)
	defer cancel()
	var res protocol.GitInfoResult
	if err := c.requestInto(ctx, protocol.TypeGitInfo, req, &res); err != nil {
		if strings.Contains(err.Error(), "unsupported request") {
			err = errAgentTooOldForGit
		}
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if res.Paths == nil {
		res.Paths = []protocol.GitPathInfo{}
	}
	writeJSON(w, res)
}

var errAgentTooOldForGit = errors.New("this machine's agent is too old to check folders; update it")
