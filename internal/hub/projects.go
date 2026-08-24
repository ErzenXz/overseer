package hub

import (
	"net/http"
	"strings"
)

const (
	maxProjectName = 80
	maxProjectPath = 4096
)

type projectInput struct {
	Name     string `json:"name"`
	DeviceId string `json:"deviceId"`
	Path     string `json:"path"`
}

func cleanProjectInput(input projectInput) (projectInput, string) {
	input.Name = strings.TrimSpace(input.Name)
	input.DeviceId = strings.TrimSpace(input.DeviceId)
	input.Path = strings.TrimSpace(input.Path)
	if input.Name == "" || input.DeviceId == "" || input.Path == "" {
		return input, "name, deviceId, and path are required"
	}
	if len(input.Name) > maxProjectName {
		return input, "project name is too long"
	}
	if len(input.Path) > maxProjectPath || strings.ContainsRune(input.Path, '\x00') {
		return input, "project path is invalid"
	}
	return input, ""
}

func (s *Server) validateProjectDevice(w http.ResponseWriter, deviceId string) bool {
	device, err := s.store.DeviceById(deviceId)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if device == nil {
		httpError(w, http.StatusBadRequest, "device does not exist")
		return false
	}
	return true
}

func (s *Server) handleListProjects(w http.ResponseWriter, _ *http.Request) {
	projects, err := s.store.ListProjects()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var input projectInput
	if err := readJSON(r, &input); err != nil {
		httpError(w, http.StatusBadRequest, "invalid project")
		return
	}
	var message string
	if input, message = cleanProjectInput(input); message != "" {
		httpError(w, http.StatusBadRequest, message)
		return
	}
	if !s.validateProjectDevice(w, input.DeviceId) {
		return
	}
	project, err := s.store.CreateProject(input.Name, input.DeviceId, input.Path)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, project)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	var input projectInput
	if err := readJSON(r, &input); err != nil {
		httpError(w, http.StatusBadRequest, "invalid project")
		return
	}
	var message string
	if input, message = cleanProjectInput(input); message != "" {
		httpError(w, http.StatusBadRequest, message)
		return
	}
	if !s.validateProjectDevice(w, input.DeviceId) {
		return
	}
	project, err := s.store.UpdateProject(r.PathValue("id"), input.Name, input.DeviceId, input.Path)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if project == nil {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	writeJSON(w, project)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	project, err := s.store.ProjectById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if project == nil {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	if err := s.store.DeleteProject(project.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// handleProjectExec is the narrow host boundary used by browser-hosted fx.
// The browser supplies only a command; the hub owns the selected node and cwd.
func (s *Server) handleProjectExec(w http.ResponseWriter, r *http.Request) {
	project, err := s.store.ProjectById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if project == nil {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	c := s.registry.get(project.DeviceId)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "project device is offline")
		return
	}
	var input struct {
		Command   string `json:"command"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	if err := readJSON(r, &input); err != nil || strings.TrimSpace(input.Command) == "" {
		httpError(w, http.StatusBadRequest, "command required")
		return
	}
	if len(input.Command) > 64*1024 {
		httpError(w, http.StatusBadRequest, "command is too long")
		return
	}
	timeoutSec := input.TimeoutMs / 1000
	if timeoutSec < 1 {
		timeoutSec = 30
	}
	if timeoutSec > 600 {
		timeoutSec = 600
	}
	result, err := s.execOnDevice(c, input.Command, project.Path, timeoutSec)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	_ = s.store.TouchProject(project.Id)
	writeJSON(w, result)
}
