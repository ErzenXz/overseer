package hub

import "sort"

// Presence: who has a session open right now. It rides on the session's own
// websocket (/api/ws/threads/{id}): a person is present while a connection of
// theirs is open, and the connection's 30 second ping is the heartbeat that
// drops people whose browser vanished. Changes are pushed to everyone else
// watching the same session as {"type":"presence","users":[{id,name}]}.

type presenceSlot struct{ views int }

type presentUser struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

// presenceJoin registers one open view and returns the function that ends it.
func (s *Server) presenceJoin(threadID string, u User) func() {
	if u.ID == "" {
		return func() {} // API tokens have no face
	}
	s.team.mu.Lock()
	if s.team.presence == nil {
		s.team.presence = map[string]map[string]*presenceSlot{}
	}
	users := s.team.presence[threadID]
	if users == nil {
		users = map[string]*presenceSlot{}
		s.team.presence[threadID] = users
	}
	slot := users[u.ID]
	if slot == nil {
		slot = &presenceSlot{}
		users[u.ID] = slot
	}
	slot.views++
	s.team.mu.Unlock()
	s.pushPresence(threadID)

	return func() {
		s.team.mu.Lock()
		if users := s.team.presence[threadID]; users != nil {
			if slot := users[u.ID]; slot != nil {
				slot.views--
				if slot.views <= 0 {
					delete(users, u.ID)
				}
			}
			if len(users) == 0 {
				delete(s.team.presence, threadID)
			}
		}
		s.team.mu.Unlock()
		s.pushPresence(threadID)
	}
}

// presentIn lists who has the session open, by name.
func (s *Server) presentIn(threadID string) []presentUser {
	s.team.mu.Lock()
	ids := make([]string, 0, len(s.team.presence[threadID]))
	for id := range s.team.presence[threadID] {
		ids = append(ids, id)
	}
	s.team.mu.Unlock()
	out := make([]presentUser, 0, len(ids))
	for _, id := range ids {
		out = append(out, presentUser{Id: id, Name: s.userName(id)})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name || (out[i].Name == out[j].Name && out[i].Id < out[j].Id)
	})
	return out
}

func (s *Server) pushPresence(threadID string) {
	s.threads.push(threadID, map[string]any{"type": "presence", "users": s.presentIn(threadID)})
}
