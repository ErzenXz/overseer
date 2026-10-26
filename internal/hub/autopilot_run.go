package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// The autopilot's engine: a poller that looks for newly labelled issues, and
// one goroutine per run that carries it from "queued" to a pull request.
//
// Everything a run needs to continue is in its row (autopilot_runs), so a hub
// restart picks up where it was: queued runs are placed again, preparing runs
// repeat their idempotent steps (labelling, the worktree, the session start
// with a fixed request id), working runs go back to watching their session,
// and finishing runs repeat the finish step, which reuses an open pull
// request instead of making another.

// Timings. Variables so tests can shorten them.
var (
	autopilotTick         = 5 * time.Second
	autopilotPollEvery    = 2 * time.Minute
	autopilotFirstPoll    = 15 * time.Second
	autopilotWatchEvery   = 3 * time.Second
	autopilotWaitLimit    = 45 * time.Minute // a session may wait this long for an approval
	autopilotMaxRun       = 3 * time.Hour
	autopilotOfflineGrace = 10 * time.Minute
	autopilotHold         = 30 * time.Second
	autopilotResumeGap    = 20 * time.Second
	autopilotShotWait     = 45 * time.Second
)

const (
	apMaxNewPerPoll = 10
	apMaxActive     = 6 // runs in flight across all repos
	apMaxResumes    = 2
)

// startAutopilot starts the issue poller and the screenshot watcher.
func (s *Server) startAutopilot(ctx context.Context) {
	go s.runAutopilot(ctx)
	go s.runShots(ctx)
}

func (s *Server) runAutopilot(ctx context.Context) {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.autopilotTickOnce(ctx)
		timer.Reset(autopilotTick)
	}
}

func (s *Server) autopilotTickOnce(ctx context.Context) {
	s.apPollDue(ctx)
	s.apDispatch(ctx)
}

// ---- polling ----

func apJitter(d time.Duration) time.Duration {
	return time.Duration(float64(d) * (0.85 + rand.Float64()*0.3))
}

func (s *Server) apPollDue(ctx context.Context) {
	repos, err := s.store.apListRepos()
	if err != nil {
		log.Printf("autopilot: %v", err)
		return
	}
	now := time.Now()
	for _, repo := range repos {
		if !repo.Enabled {
			continue
		}
		s.autopilot.mu.Lock()
		if s.autopilot.nextPoll == nil {
			s.autopilot.nextPoll = map[string]time.Time{}
		}
		next, known := s.autopilot.nextPoll[repo.Id]
		if !known {
			s.autopilot.nextPoll[repo.Id] = now.Add(autopilotFirstPoll)
			s.autopilot.mu.Unlock()
			continue
		}
		due := !now.Before(next)
		s.autopilot.mu.Unlock()
		if due && s.apBeginPoll(repo.Id) {
			go func() {
				defer s.apEndPoll(repo.Id)
				s.apPoll(ctx, repo)
			}()
		}
	}
}

func (s *Server) apBeginPoll(id string) bool {
	s.autopilot.mu.Lock()
	defer s.autopilot.mu.Unlock()
	if s.autopilot.polling == nil {
		s.autopilot.polling = map[string]bool{}
	}
	if s.autopilot.polling[id] {
		return false
	}
	s.autopilot.polling[id] = true
	return true
}

func (s *Server) apEndPoll(id string) {
	s.autopilot.mu.Lock()
	delete(s.autopilot.polling, id)
	if s.autopilot.nextPoll == nil {
		s.autopilot.nextPoll = map[string]time.Time{}
	}
	s.autopilot.nextPoll[id] = time.Now().Add(apJitter(autopilotPollEvery))
	s.autopilot.mu.Unlock()
}

// autopilotPollNow checks a repo right away (the "Check now" button). It
// returns false when a check is already running.
func (s *Server) autopilotPollNow(id string) bool {
	repo, err := s.store.apRepoById(id)
	if err != nil || repo == nil || !s.apBeginPoll(id) {
		return false
	}
	go func() {
		defer s.apEndPoll(id)
		s.apPoll(context.Background(), *repo)
	}()
	return true
}

// apPoll looks at one repo: new labelled issues become runs, and pull
// requests that were open are checked for a merge.
func (s *Server) apPoll(ctx context.Context, repo autopilotRepo) {
	issues, err := s.apListIssues(repo)
	if err != nil {
		msg := err.Error()
		if errors.Is(err, errApOffline) {
			msg = "The machine that watches GitHub for this repo is offline."
		}
		s.store.apRecordPoll(repo.Id, apClip(msg, 200))
		return
	}
	added := 0
	for _, issue := range issues {
		if ctx.Err() != nil {
			return
		}
		if issue.hasLabel(apLabelWorking) || issue.hasLabel(apLabelDone) || issue.hasLabel(apLabelFailed) {
			continue // another Overseer already took it
		}
		known, err := s.store.apRunByIssue(repo.Repo, issue.Number)
		if err != nil {
			log.Printf("autopilot: %v", err)
			continue
		}
		if known != nil {
			s.apRecheckSkipped(repo, known, issue)
			continue
		}
		if added >= apMaxNewPerPoll {
			break
		}
		added++
		ok, labeller, reason := s.apTrust(repo, issue.Number)
		run := autopilotRun{Id: randomToken()[:16], RepoId: repo.Id, Repo: repo.Repo, Number: issue.Number, Title: apClip(issue.Title, 300),
			Url: issue.Url, Author: issue.Author.Login, Labeller: labeller, Status: apQueued, Seen: issue.UpdatedAt}
		if !ok {
			run.Status, run.Detail = apSkipped, reason
		}
		if _, err := s.store.apInsertRun(run); err != nil {
			log.Printf("autopilot: %v", err)
		}
	}
	s.apTrackPRs(repo)
	s.store.apRecordPoll(repo.Id, "")
}

// apRecheckSkipped looks again at an issue that was waiting for approval when
// someone with write access may have since labelled it.
func (s *Server) apRecheckSkipped(repo autopilotRepo, run *autopilotRun, issue apIssue) {
	if run.Status != apSkipped || run.Approved || run.Seen == issue.UpdatedAt || run.Detail == "Autopilot was turned off for this repo." {
		return
	}
	ok, labeller, reason := s.apTrust(repo, issue.Number)
	f := apFields{"seen_updated": issue.UpdatedAt, "labeller": labeller, "detail": reason}
	if ok {
		f["status"], f["detail"] = apQueued, ""
	}
	s.store.apUpdate(run.Id, f)
}

// apTrackPRs marks runs whose pull request has been merged or closed.
func (s *Server) apTrackPRs(repo autopilotRepo) {
	open, err := s.store.apRunsOfRepo(repo.Repo, apPROpen)
	if err != nil {
		return
	}
	if len(open) > 15 {
		open = open[:15]
	}
	for _, run := range open {
		if run.PRNumber == 0 {
			continue
		}
		state, err := s.apPRState(repo, run.PRNumber)
		if err != nil {
			continue
		}
		switch state {
		case "MERGED":
			s.store.apUpdate(run.Id, apFields{"status": apMerged, "finished_at": time.Now().Unix()})
			s.apMarkThreadPR(run.ThreadId, run.PRUrl, run.PRNumber, "merged")
		case "CLOSED":
			s.store.apUpdate(run.Id, apFields{"status": apClosed, "finished_at": time.Now().Unix()})
			s.apMarkThreadPR(run.ThreadId, run.PRUrl, run.PRNumber, "closed")
		}
	}
}

// ---- placing and driving runs ----

func (s *Server) apDispatch(ctx context.Context) {
	runs, err := s.store.apActiveRuns()
	if err != nil {
		log.Printf("autopilot: %v", err)
		return
	}
	byRepo := map[string]int{}
	total := 0
	for _, run := range runs {
		if run.Status != apQueued {
			byRepo[strings.ToLower(run.Repo)]++
			total++
		}
	}
	now := time.Now()
	for _, run := range runs {
		if ctx.Err() != nil {
			return
		}
		if run.Status != apQueued {
			if s.autopilot.markDriving(run.Id) {
				go s.apDrive(ctx, run.Id)
			}
			continue
		}
		s.autopilot.mu.Lock()
		hold := s.autopilot.holdUntil[run.Id]
		s.autopilot.mu.Unlock()
		if now.Before(hold) {
			continue
		}
		repo, err := s.store.apRepoById(run.RepoId)
		if err != nil {
			continue
		}
		if repo == nil {
			s.store.apUpdate(run.Id, apFields{"status": apSkipped, "detail": "Autopilot was turned off for this repo."})
			continue
		}
		key := strings.ToLower(run.Repo)
		if !repo.Enabled || byRepo[key] >= repo.MaxConcurrent || total >= apMaxActive {
			continue
		}
		if !s.autopilot.markDriving(run.Id) {
			continue
		}
		// Take the slot now so the next run in this loop sees it.
		if err := s.store.apUpdate(run.Id, apFields{"status": apPreparing, "detail": ""}); err != nil {
			s.autopilot.doneDriving(run.Id)
			continue
		}
		byRepo[key]++
		total++
		go s.apDrive(ctx, run.Id)
	}
}

// apWait is returned by a step that cannot go on yet (no machine free, a
// machine offline): the run goes back to the queue and is tried again.
type apWait string

func (w apWait) Error() string { return string(w) }

// apDrive carries one run forward until it finishes or must wait.
func (s *Server) apDrive(ctx context.Context, id string) {
	defer s.autopilot.doneDriving(id)
	for ctx.Err() == nil {
		run, err := s.store.apRunById(id)
		if err != nil || run == nil {
			return
		}
		switch run.Status {
		case apPreparing:
			err := s.apPrepare(ctx, run)
			var wait apWait
			switch {
			case err == nil:
			case errors.As(err, &wait):
				s.autopilot.mu.Lock()
				if s.autopilot.holdUntil == nil {
					s.autopilot.holdUntil = map[string]time.Time{}
				}
				s.autopilot.holdUntil[id] = time.Now().Add(autopilotHold)
				s.autopilot.mu.Unlock()
				s.store.apUpdate(id, apFields{"status": apQueued, "detail": string(wait)})
				return
			case ctx.Err() != nil:
				return
			default:
				s.apFail(run, err.Error())
				return
			}
		case apWorking:
			if !s.apWatch(ctx, run) {
				return
			}
		case apFinishing:
			if !s.apFinish(ctx, run) {
				return
			}
		default:
			return
		}
	}
}

// apFail ends a run. If the issue was claimed it is relabelled and, unless
// the failure was the user's own stop, commented on.
func (s *Server) apFail(run *autopilotRun, reason string) {
	reason = apClip(strings.Map(func(r rune) rune {
		if r == '\n' || r >= 0x20 && r != 0x7f {
			return r
		}
		return ' '
	}, strings.TrimSpace(reason)), 700)
	fresh, _ := s.store.apRunById(run.Id)
	if fresh == nil || !apActive(fresh.Status) {
		return // stopped or finished by someone else in the meantime
	}
	s.store.apUpdate(run.Id, apFields{"status": apFailed, "detail": reason, "finished_at": time.Now().Unix()})
	if !fresh.Labelled {
		return
	}
	repo, _ := s.store.apRepoById(run.RepoId)
	if repo == nil {
		return
	}
	if err := s.apSetLabels(*repo, run.Number, apLabelFailed, apLabelWorking); err != nil {
		log.Printf("autopilot: labelling %s#%d: %v", run.Repo, run.Number, err)
	}
	if err := s.apComment(*repo, run.Number, "Overseer could not finish this issue.\n\n"+apDefang(reason, 400)+"\n\nRemove the `"+apLabelFailed+"` label and add `"+repo.Label+"` again to try once more."); err != nil {
		log.Printf("autopilot: commenting on %s#%d: %v", run.Repo, run.Number, err)
	}
}

// apStop is the user's Stop button.
func (s *Server) apStop(run *autopilotRun) {
	if run.ThreadId != "" {
		if t, _ := s.store.ThreadById(run.ThreadId); t != nil {
			if c := s.registry.get(t.DeviceId); c != nil {
				ctx, cancel := contextWithTimeout(15 * time.Second)
				c.requestInto(ctx, protocol.TypeThreadCancel, protocol.ThreadRef{ThreadId: t.Id}, nil)
				cancel()
			}
		}
	}
	s.store.apUpdate(run.Id, apFields{"status": apFailed, "detail": "Stopped by you.", "finished_at": time.Now().Unix()})
	if run.Labelled {
		if repo, _ := s.store.apRepoById(run.RepoId); repo != nil {
			s.apSetLabels(*repo, run.Number, "", apLabelWorking)
		}
	}
}

// ---- preparing ----

func (s *Server) apKnownPaths(deviceId string) []string {
	projects, err := s.store.ListProjects()
	if err != nil {
		return nil
	}
	var paths []string
	for _, p := range projects {
		if p.DeviceId == deviceId && len(paths) < 16 {
			paths = append(paths, p.Path)
		}
	}
	return paths
}

// apPlanClone asks a machine whether it has a clone of repo, and where.
func (s *Server) apPlanClone(c *agentConn, repo, branch string) (bool, string) {
	ctx, cancel := contextWithTimeout(25 * time.Second)
	defer cancel()
	var res protocol.GitPrepareResult
	err := c.requestInto(ctx, protocol.TypeGitPrepare, protocol.GitPrepareRequest{Repo: repo, Branch: branch, Plan: true, Known: s.apKnownPaths(c.deviceId)}, &res)
	if err != nil || res.Action == protocol.PrepareClone {
		return false, ""
	}
	if res.Source != "" {
		return true, res.Source
	}
	return true, res.Path
}

// apBusy counts what a machine is already doing.
func (s *Server) apBusy(deviceId string) int {
	var n int
	s.store.db.QueryRow(`SELECT COUNT(*) FROM threads WHERE device_id = ? AND status IN ('starting','working','waiting')`, deviceId).Scan(&n)
	var m int
	s.store.db.QueryRow(`SELECT COUNT(*) FROM autopilot_runs WHERE device_id = ? AND status IN ('preparing')`, deviceId).Scan(&m)
	return n + m
}

// apPickDevice chooses the machine for a run: the one set for the repo, or
// the least busy online machine that has a clone. Autopilot never clones a
// repo by itself.
func (s *Server) apPickDevice(repo autopilotRepo, run *autopilotRun, base string) (*agentConn, error) {
	var candidates []*agentConn
	if repo.DeviceId != "" {
		c := s.registry.get(repo.DeviceId)
		if c == nil {
			name := repo.DeviceId
			if d, _ := s.store.DeviceById(repo.DeviceId); d != nil {
				name = d.Name
			}
			return nil, apWait(name + " is offline. Waiting for it to come back.")
		}
		candidates = []*agentConn{c}
	} else {
		candidates = s.registry.all()
		if len(candidates) == 0 {
			return nil, apWait("No machine is online. Waiting for one.")
		}
	}
	type scored struct {
		c    *agentConn
		busy int
		keep bool
	}
	var usable []scored
	for _, c := range candidates {
		if has, _ := s.apPlanClone(c, repo.Repo, base); has {
			usable = append(usable, scored{c, s.apBusy(c.deviceId), c.deviceId == run.DeviceId})
		}
	}
	if len(usable) == 0 {
		where := "an online machine has"
		if repo.DeviceId != "" {
			where = "the chosen machine has"
		}
		return nil, fmt.Errorf("No clone of %s was found, and autopilot does not clone repos by itself. Clone it on a machine first (where %s it), then retry.", repo.Repo, where)
	}
	sort.SliceStable(usable, func(i, j int) bool {
		if usable[i].keep != usable[j].keep {
			return usable[i].keep // a retry stays where its worktree is
		}
		return usable[i].busy < usable[j].busy
	})
	return usable[0].c, nil
}

func (s *Server) apPrepare(ctx context.Context, run *autopilotRun) error {
	repo, err := s.store.apRepoById(run.RepoId)
	if err != nil {
		return err
	}
	if repo == nil {
		return errors.New("Autopilot was turned off for this repo.")
	}
	detail, err := s.apIssueDetail(*repo, run.Number)
	if err != nil {
		return apTransient(err, "Could not read the issue: ")
	}
	if strings.EqualFold(detail.State, "CLOSED") {
		s.store.apUpdate(run.Id, apFields{"status": apSkipped, "detail": "The issue was closed before it ran.", "finished_at": time.Now().Unix()})
		return nil
	}
	base := run.Base
	if base == "" {
		if base, err = s.apDefaultBranch(*repo); err != nil {
			return apTransient(err, "")
		}
	}
	branch := run.Branch
	if branch == "" {
		branch = apBranchName(run.Number, detail.Title)
	}
	c, err := s.apPickDevice(*repo, run, base)
	if err != nil {
		return err
	}
	if err := s.store.apUpdate(run.Id, apFields{"title": apClip(detail.Title, 300), "author": detail.Author.Login, "device_id": c.deviceId, "base": base, "branch": branch}); err != nil {
		return err
	}

	// Claim the issue so nobody (and no second Overseer) starts it again.
	if !run.Labelled {
		if err := s.apEnsureLabels(*repo); err != nil {
			return apTransient(err, "Could not create the overseer labels: ")
		}
		if err := s.apSetLabels(*repo, run.Number, apLabelWorking, ""); err != nil {
			return apTransient(err, "Could not label the issue: ")
		}
		s.store.apUpdate(run.Id, apFields{"labelled": 1})
		run.Labelled = true
	}
	if repo.Comment && !run.Commented {
		if err := s.apComment(*repo, run.Number, "🤖 Working on this in Overseer"); err != nil {
			log.Printf("autopilot: commenting on %s#%d: %v", run.Repo, run.Number, err)
		}
		s.store.apUpdate(run.Id, apFields{"commented": 1}) // one try: never comment twice
	}

	// The worktree, on a new branch off the default branch.
	pctx, cancel := context.WithTimeout(ctx, prepareJobTimeout)
	defer cancel()
	var prep protocol.GitPrepareResult
	err = c.requestInto(pctx, protocol.TypeGitPrepare, protocol.GitPrepareRequest{
		Repo: repo.Repo, Branch: branch, CreateFrom: base, Known: s.apKnownPaths(c.deviceId),
	}, &prep)
	if err != nil {
		if strings.Contains(err.Error(), "unsupported request") {
			return errors.New("This machine's agent is too old for the autopilot; update it.")
		}
		return fmt.Errorf("Could not set up the checkout: %s", apOneLine(err.Error(), 200))
	}

	// The session. The request id is fixed per attempt, so a restart here
	// finds the session the first try made instead of starting another.
	fence := randomToken()[:12]
	in := threadInput{
		DeviceId: c.deviceId, Agent: repo.Agent, Cwd: prep.Path, Model: repo.Model, Effort: repo.Effort, Mode: repo.Mode, Access: repo.Access,
		Title:           apClip(fmt.Sprintf("Issue #%d: %s", run.Number, detail.Title), 120),
		Prompt:          apBuildPrompt(*repo, detail, branch, base, fence),
		ClientRequestId: fmt.Sprintf("ap-%s-%d", run.Id, run.Attempt),
	}
	if msg := in.validate(s.agents); msg != "" {
		return errors.New("The session could not be started: " + msg)
	}
	s.startMu.Lock()
	thread, err := s.store.ThreadByRequestId(in.ClientRequestId)
	if err == nil && thread == nil {
		thread, err = s.createThread(in)
	}
	s.startMu.Unlock()
	if err != nil || thread == nil {
		return fmt.Errorf("The session could not be started: %v", err)
	}
	return s.store.apUpdate(run.Id, apFields{"status": apWorking, "detail": "", "thread_id": thread.Id, "worktree": prep.Path, "started_at": time.Now().Unix()})
}

// apTransient decides whether a failed GitHub call is worth waiting out. A
// machine that is offline or a rate limit is; anything else fails the run.
func apTransient(err error, prefix string) error {
	var f *ghFailure
	switch {
	case errors.Is(err, errApOffline):
		return apWait("The machine that watches GitHub for this repo is offline. Waiting for it.")
	case errors.As(err, &f) && (strings.Contains(f.message, "rate limit") || strings.Contains(f.message, "too long")):
		return apWait(f.message)
	}
	return errors.New(prefix + apOneLine(err.Error(), 200))
}

// ---- watching the session ----

// apWatch follows the run's session until it ends. It returns true when the
// run moved on (so apDrive should look at it again).
func (s *Server) apWatch(ctx context.Context, run *autopilotRun) bool {
	for {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(autopilotWatchEvery):
		}
		cur, err := s.store.apRunById(run.Id)
		if err != nil || cur == nil || cur.Status != apWorking {
			return false
		}
		t, err := s.store.ThreadById(cur.ThreadId)
		if err != nil {
			continue
		}
		if t == nil {
			s.apFail(cur, "The session was deleted before it finished.")
			return false
		}
		started := time.Unix(cur.StartedAt, 0)
		if cur.StartedAt > 0 && time.Since(started) > autopilotMaxRun {
			s.apCancelThread(t)
			s.apFail(cur, fmt.Sprintf("It ran for more than %d hours and was stopped.", int(autopilotMaxRun.Hours())))
			return false
		}
		offline := s.registry.get(t.DeviceId) == nil
		if offline && t.Status != "idle" {
			if s.apOfflineFor(cur.Id) > autopilotOfflineGrace {
				s.apFail(cur, "The machine went offline and did not come back. The work may still be on it, on branch "+cur.Branch+".")
				return false
			}
		} else {
			s.autopilot.mu.Lock()
			delete(s.autopilot.offlineAt, cur.Id)
			s.autopilot.mu.Unlock()
		}
		switch t.Status {
		case "idle":
			s.store.apUpdate(cur.Id, apFields{"status": apFinishing, "detail": ""})
			return true
		case "error":
			if offline && apOfflineText(t.Error) {
				continue
			}
			s.apFail(cur, "The agent stopped with an error: "+apOneLine(t.Error, 200))
			return false
		case "stopped":
			s.autopilot.mu.Lock()
			last := s.autopilot.resumedAt[cur.Id]
			s.autopilot.mu.Unlock()
			if time.Since(last) < autopilotResumeGap {
				continue
			}
			if cur.Resumes >= apMaxResumes {
				s.apFail(cur, "The session was interrupted too many times.")
				return false
			}
			s.apNudge(cur, t)
		case "waiting":
			s.autopilot.mu.Lock()
			if s.autopilot.waitingAt == nil {
				s.autopilot.waitingAt = map[string]time.Time{}
			}
			since, ok := s.autopilot.waitingAt[cur.Id]
			if !ok {
				since = time.Now()
				s.autopilot.waitingAt[cur.Id] = since
			}
			s.autopilot.mu.Unlock()
			if time.Since(since) > autopilotWaitLimit {
				s.apCancelThread(t)
				s.apFail(cur, "The agent was waiting for an approval and nobody was there. Choose Auto or Full access for this repo so it can work on its own.")
				return false
			}
		default:
			s.autopilot.mu.Lock()
			delete(s.autopilot.waitingAt, cur.Id)
			s.autopilot.mu.Unlock()
		}
	}
}

func apOfflineText(text string) bool {
	low := strings.ToLower(text)
	return strings.Contains(low, "offline") || strings.Contains(low, "disconnected")
}

// apOfflineFor says how long a run's machine has been unreachable.
func (s *Server) apOfflineFor(id string) time.Duration {
	s.autopilot.mu.Lock()
	defer s.autopilot.mu.Unlock()
	if s.autopilot.offlineAt == nil {
		s.autopilot.offlineAt = map[string]time.Time{}
	}
	since, ok := s.autopilot.offlineAt[id]
	if !ok {
		s.autopilot.offlineAt[id] = time.Now()
		return 0
	}
	return time.Since(since)
}

func (s *Server) apCancelThread(t *Thread) {
	if c := s.registry.get(t.DeviceId); c != nil {
		ctx, cancel := contextWithTimeout(15 * time.Second)
		defer cancel()
		c.requestInto(ctx, protocol.TypeThreadCancel, protocol.ThreadRef{ThreadId: t.Id}, nil)
	}
}

// apNudge asks a session that a hub restart interrupted to carry on.
func (s *Server) apNudge(run *autopilotRun, t *Thread) {
	s.autopilot.mu.Lock()
	if s.autopilot.resumedAt == nil {
		s.autopilot.resumedAt = map[string]time.Time{}
	}
	s.autopilot.resumedAt[run.Id] = time.Now()
	s.autopilot.mu.Unlock()
	s.store.apUpdate(run.Id, apFields{"resumes": run.Resumes + 1})
	text := "The hub was restarted while you were working on this issue. Carry on from where you left off, and finish the task."
	msgId := s.threads.recordUser(t.Id, text, nil, false)
	go s.threads.deliver(t.Id, hubPrompt{MessageId: msgId, Text: text})
}

// ---- finishing ----

// apFinish turns the session's work into a pull request. It returns true when
// the run moved on.
func (s *Server) apFinish(ctx context.Context, run *autopilotRun) bool {
	repo, _ := s.store.apRepoById(run.RepoId)
	if repo == nil {
		s.apFail(run, "Autopilot was turned off for this repo.")
		return false
	}
	t, _ := s.store.ThreadById(run.ThreadId)
	summary := ""
	if t != nil {
		msgs, _ := s.store.ThreadMessages(t.Id)
		summary = apLastAssistantText(msgs)
		// The "after" picture, while the preview is still running.
		sctx, cancel := context.WithTimeout(ctx, autopilotShotWait)
		s.shotsEnsureAfter(sctx, t.Id)
		cancel()
	}
	c := s.registry.get(run.DeviceId)
	if c == nil {
		if s.apOfflineFor(run.Id) > autopilotOfflineGrace {
			s.apFail(run, "The machine went offline before the pull request was opened. The work is still on it, on branch "+run.Branch+".")
			return false
		}
		select {
		case <-ctx.Done():
		case <-time.After(autopilotWatchEvery * 2):
		}
		return true
	}
	fctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	var res protocol.AutopilotFinishResult
	err := c.requestInto(fctx, protocol.TypeAutopilotFinish, protocol.AutopilotFinish{
		Cwd: run.Worktree, Repo: repo.Repo, Branch: run.Branch, Base: run.Base,
		Title: apPRTitle(run.Number, run.Title), Body: apPRBody(run.Number, summary, repo.Footer),
		CommitMessage: apPRTitle(run.Number, run.Title) + "\n\nFixes #" + fmt.Sprint(run.Number),
	}, &res)
	if ctx.Err() != nil {
		return false
	}
	if err != nil {
		if strings.Contains(err.Error(), "unsupported request") {
			s.apFail(run, "This machine's agent is too old for the autopilot; update it.")
			return false
		}
		if strings.Contains(err.Error(), "disconnected") {
			select { // the connection dropped: try again shortly
			case <-ctx.Done():
				return false
			case <-time.After(autopilotWatchEvery * 2):
			}
			return true
		}
		s.apFail(run, "Could not open the pull request: "+apOneLine(err.Error(), 200))
		return false
	}
	// A Stop pressed while this ran wins.
	if cur, _ := s.store.apRunById(run.Id); cur == nil || cur.Status != apFinishing {
		return false
	}
	switch {
	case res.Error != "":
		s.apFail(run, res.Error)
		return false
	case res.NoChanges:
		note := "The agent finished without changing any files, so there is nothing to propose."
		if s := apDefang(summary, 600); s != "" {
			note += "\n\nWhat it said:\n\n" + s
		}
		s.apFail(run, note)
		return false
	}
	s.store.apUpdate(run.Id, apFields{"status": apPROpen, "detail": "", "pr_url": res.PRUrl, "pr_number": res.PRNumber, "finished_at": time.Now().Unix()})
	if t != nil {
		s.apMarkThreadPR(t.Id, res.PRUrl, res.PRNumber, "open")
	}
	if err := s.apSetLabels(*repo, run.Number, apLabelDone, apLabelWorking); err != nil {
		log.Printf("autopilot: labelling %s#%d: %v", run.Repo, run.Number, err)
	}
	if t != nil {
		go s.shotsOnPullRequest(context.Background(), t.Id, repo.Repo, res.PRNumber)
	}
	return false
}

// apMarkThreadPR records the pull request on the session so the sidebar and
// the session header show it.
func (s *Server) apMarkThreadPR(threadId, url string, number int, state string) {
	if threadId == "" || url == "" {
		return
	}
	t, err := s.store.ThreadById(threadId)
	if err != nil || t == nil {
		return
	}
	pr := ThreadPR{Url: url, Number: number, State: state}
	b, _ := json.Marshal(pr)
	if _, err := s.store.db.Exec(`UPDATE threads SET pr = ? WHERE id = ?`, string(b), threadId); err == nil {
		s.threads.pushThread(threadId)
	}
}

// ---- machines with a clone (for the settings page) ----

type apCloneInfo struct {
	DeviceId string `json:"deviceId"`
	Name     string `json:"name"`
	HasClone bool   `json:"hasClone"`
	Path     string `json:"path,omitempty"`
	Busy     int    `json:"busy"`
}

func (s *Server) handleAutopilotClones(w http.ResponseWriter, r *http.Request) {
	repo, _, ok := parseRepoRef(r.URL.Query().Get("repo"))
	if !ok {
		httpError(w, http.StatusBadRequest, "repo must be owner/name")
		return
	}
	conns := s.registry.all()
	out := make([]apCloneInfo, len(conns))
	done := make(chan struct{}, len(conns))
	for i, c := range conns {
		go func() {
			defer func() { done <- struct{}{} }()
			info := apCloneInfo{DeviceId: c.deviceId, Name: c.deviceId, Busy: s.apBusy(c.deviceId)}
			if d, _ := s.store.DeviceById(c.deviceId); d != nil {
				info.Name = d.Name
			}
			info.HasClone, info.Path = s.apPlanClone(c, repo, "main")
			out[i] = info
		}()
	}
	for range conns {
		<-done
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, out)
}
