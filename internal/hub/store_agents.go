package hub

import "time"

// --- custom agents (agent catalog) ---

// customAgentRow is a user-added ACP agent: a name and its command line.
type customAgentRow struct {
	Id        string
	Name      string
	Command   string
	CreatedAt int64
}

func (s *Store) ListCustomAgents() ([]customAgentRow, error) {
	rows, err := s.db.Query(`SELECT id, name, command, created_at FROM custom_agents ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []customAgentRow{}
	for rows.Next() {
		var a customAgentRow
		if err := rows.Scan(&a.Id, &a.Name, &a.Command, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CreateCustomAgent stores a new custom agent; it fails if the id exists.
func (s *Store) CreateCustomAgent(id, name, command string) (customAgentRow, error) {
	a := customAgentRow{Id: id, Name: name, Command: command, CreatedAt: time.Now().Unix()}
	_, err := s.db.Exec(`INSERT INTO custom_agents (id, name, command, created_at) VALUES (?, ?, ?, ?)`,
		a.Id, a.Name, a.Command, a.CreatedAt)
	return a, err
}

// DeleteCustomAgent removes a custom agent and reports whether it existed.
func (s *Store) DeleteCustomAgent(id string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM custom_agents WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
