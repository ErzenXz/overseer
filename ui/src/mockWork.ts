// DEV-ONLY demo sessions that show the agent at work: a finished turn with
// many mixed steps, a live turn that keeps streaming, a Claude turn with
// parallel subagents (one still running) and a Codex turn with a subagent.
// mockThreads.ts hands in the helpers it already has (the kit).

import type { Thread, ThreadMessage, ToolAgent, ToolFile } from './types'

export interface MockKit {
  nowMs(): number
  msg(threadId: string, partial: Partial<ThreadMessage> & Pick<ThreadMessage, 'role'>, at: number): ThreadMessage
  push(threadId: string, partial: Partial<ThreadMessage> & Pick<ThreadMessage, 'role'>): ThreadMessage
  update(threadId: string, message: ThreadMessage, patch: Partial<ThreadMessage>): void
  later(threadId: string, ms: number, fn: () => void): void
  cancelTimers(threadId: string): void
  touch(thread: Thread, patch: Partial<Thread>): void
  messages: Record<string, ThreadMessage[]>
  listening(threadId: string): boolean
  snapshot(thread: Thread): void
}

export const WORK_IDS = { done: 'th_retry', live: 'th_live', agents: 'th_audit', codex: 'th_codexsub' }

// --- building blocks ---

const count = (diff: string, sign: string) => diff.split('\n').filter((line) => line.startsWith(sign)).length
const file = (path: string, diff: string): ToolFile => ({ path, diff, additions: count(diff, '+'), deletions: count(diff, '-') })

interface Spec {
  name: string
  title: string
  input?: string
  output?: string
  files?: ToolFile[]
  status?: 'running' | 'completed' | 'error'
  agent?: ToolAgent
  parent?: string
  ms?: number
}

const toolOf = (spec: Spec): NonNullable<ThreadMessage['tool']> => ({ name: spec.name, title: spec.title, status: spec.status ?? 'completed', input: spec.input, output: spec.output, files: spec.files, agent: spec.agent })

// A finished step that took ms.
function done(kit: MockKit, threadId: string, turn: string, at: number, spec: Spec): ThreadMessage {
  const m = kit.msg(threadId, { role: 'tool', turn, text: '', parentId: spec.parent, tool: toolOf(spec) }, at)
  m.updatedAt = at + (spec.ms ?? 1200)
  return m
}

function thought(kit: MockKit, threadId: string, turn: string, at: number, ms: number, text: string): ThreadMessage {
  const m = kit.msg(threadId, { role: 'thought', turn, text }, at)
  m.updatedAt = at + ms
  return m
}

const note = (kit: MockKit, threadId: string, turn: string, at: number, text: string) => kit.msg(threadId, { role: 'assistant', turn, text }, at)

// --- the diffs and outputs shared by the demos ---

const backoffGo = `@@ -0,0 +1,46 @@
+// Package retry runs an operation again when it fails for a reason that
+// is likely to pass: a dropped connection, a 429, a 5xx.
+package retry
+
+import (
+	"context"
+	"errors"
+	"math/rand"
+	"time"
+)
+
+type Policy struct {
+	Attempts int
+	Base     time.Duration
+	Max      time.Duration
+}
+
+type transient struct {
+	err   error
+	after time.Duration
+}
+
+func (t transient) Error() string { return t.err.Error() }
+func (t transient) Unwrap() error { return t.err }
+
+func Transient(err error) error                  { return transient{err: err} }
+func After(err error, d time.Duration) error     { return transient{err: err, after: d} }
+
+func Do(ctx context.Context, p Policy, op func() error) error {
+	var err error
+	for attempt := 0; attempt < p.Attempts; attempt++ {
+		if err = op(); err == nil {
+			return nil
+		}
+		var t transient
+		if !errors.As(err, &t) || attempt == p.Attempts-1 {
+			return err
+		}
+		wait := t.after
+		if wait == 0 {
+			wait = time.Duration(rand.Int63n(int64(p.Base << attempt)))
+		}
+		select {
+		case <-time.After(min(wait, p.Max)):
+		case <-ctx.Done():
+			return ctx.Err()
+		}
+	}
+	return err
+}`

const clientGo = `@@ -41,10 +41,22 @@ func (c *Client) Login(ctx context.Context, creds Credentials) (*Session, error)
 	req, err := c.newRequest(ctx, "/v1/login", creds)
 	if err != nil {
 		return nil, err
 	}
-	resp, err := c.http.Do(req)
-	if err != nil {
-		return nil, fmt.Errorf("login: %w", err)
-	}
+	var resp *http.Response
+	err = retry.Do(ctx, retry.Policy{Attempts: 4, Base: 200 * time.Millisecond, Max: 5 * time.Second}, func() error {
+		var doErr error
+		resp, doErr = c.http.Do(req.Clone(ctx))
+		if doErr != nil {
+			return retry.Transient(doErr)
+		}
+		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
+			resp.Body.Close()
+			return retry.After(fmt.Errorf("status %s", resp.Status), retryAfter(resp))
+		}
+		return nil
+	})
+	if err != nil {
+		return nil, fmt.Errorf("login: %w", err)
+	}
 	defer resp.Body.Close()`

const clientFix = `@@ -58,7 +58,8 @@ func (c *Client) Login(ctx context.Context, creds Credentials) (*Session, error)
 		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
 			resp.Body.Close()
-			return retry.After(fmt.Errorf("status %s", resp.Status), retryAfter(resp))
+			req.Body, _ = req.GetBody() // the body was consumed by the first attempt
+			return retry.After(fmt.Errorf("status %s", resp.Status), retryAfter(resp))
 		}
 		return nil
 	})`

const clientTest = `@@ -96,3 +96,34 @@ func TestLoginBadPassword(t *testing.T) {
 		t.Fatalf("want ErrUnauthorized, got %v", err)
 	}
 }
+
+func TestLoginRetriesOn503(t *testing.T) {
+	var calls atomic.Int32
+	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+		if calls.Add(1) < 3 {
+			w.WriteHeader(http.StatusServiceUnavailable)
+			return
+		}
+		w.Write([]byte(\`{"token":"abc"}\`))
+	}))
+	defer srv.Close()
+
+	if _, err := newTestClient(srv.URL).Login(context.Background(), testCreds); err != nil {
+		t.Fatal(err)
+	}
+	if got := calls.Load(); got != 3 {
+		t.Fatalf("got %d attempts, want 3", got)
+	}
+}
+
+func TestLoginDoesNotRetryUnauthorized(t *testing.T) {
+	var calls atomic.Int32
+	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+		calls.Add(1)
+		w.WriteHeader(http.StatusUnauthorized)
+	}))
+	defer srv.Close()
+	newTestClient(srv.URL).Login(context.Background(), testCreds)
+	if calls.Load() != 1 {
+		t.Fatalf("a 401 must not be retried")
+	}
+}`

const goTestFail = `--- FAIL: TestLoginRetriesOn503 (0.41s)
    client_test.go:112: got 2 attempts, want 3
        (the retried request had an empty body)
FAIL
FAIL	github.com/acme/api-gateway/internal/auth	0.612s
FAIL`

const goTestPass = 'ok  \tgithub.com/acme/api-gateway/internal/auth\t0.847s\nok  \tgithub.com/acme/api-gateway/internal/retry\t0.311s'

const loginAnswer = `Login now retries transient failures with exponential backoff and jitter, so a single \`503\` no longer logs people out.

**What changed**

- \`internal/retry/backoff.go\` is a new \`retry.Do\` helper: 4 attempts, 200 ms base, full jitter, and it honours \`Retry-After\`.
- \`internal/auth/client.go\` wraps the login request in \`retry.Do\`. Only network errors, \`429\` and \`5xx\` are retried.
- \`internal/auth/client_test.go\` adds two tests for the retry path.

| Case | Attempts | Result |
|---|---|---|
| \`503\`, \`503\`, \`200\` | 3 | logs in |
| \`401\` | 1 | fails at once |
| network error ×4 | 4 | \`login: …\` error |

The first test run caught a real bug: the request body was already consumed on the second attempt, so the retry sent an empty login. It now re-reads the body with \`req.GetBody()\`.

\`go test ./internal/...\` and \`go vet ./...\` pass. I did not run the integration suite, which needs Redis.`

// --- (a) a finished turn with ~15 steps ---

export function seedFinished(kit: MockKit) {
  const id = WORK_IDS.done
  let t = kit.nowMs() - 26 * 60_000
  const next = (ms: number) => (t += ms)
  const user = kit.msg(id, { role: 'user', text: 'Logins fail whenever the auth service returns a 503. Add retry with backoff to the login client and cover it with tests.' }, next(0))
  const turn = user.id
  thought(kit, id, turn, next(1500), 7000, 'The client calls http.Do once and returns the first error. I need to find where Login is defined, check how errors are classified, and make sure a retried request still has its body. Only transient failures should retry: network errors, 429 and 5xx. A 401 must fail immediately.')
  note(kit, id, turn, next(8000), 'I’ll start by finding the login client and its tests.')
  done(kit, id, turn, next(1500), { name: 'grep', title: 'Search for func (c *Client) Login', input: 'func (c \\*Client) Login', output: 'internal/auth/client.go:38:func (c *Client) Login(ctx context.Context, creds Credentials) (*Session, error) {' , ms: 900 })
  done(kit, id, turn, next(1200), { name: 'read', title: 'Read client.go', input: 'internal/auth/client.go', output: '    38\tfunc (c *Client) Login(ctx context.Context, creds Credentials) (*Session, error) {\n    39\t\treq, err := c.newRequest(ctx, "/v1/login", creds)\n    40\t\tif err != nil {\n    41\t\t\treturn nil, err\n    42\t\t}\n    43\t\tresp, err := c.http.Do(req)\n    44\t\tif err != nil {\n    45\t\t\treturn nil, fmt.Errorf("login: %w", err)\n    46\t\t}\n    …', ms: 500 })
  done(kit, id, turn, next(900), { name: 'read', title: 'Read client_test.go', input: 'internal/auth/client_test.go', output: '    1\tpackage auth\n    2\t\n    3\timport (\n    …', ms: 500 })
  done(kit, id, turn, next(800), { name: 'read', title: 'Read errors.go', input: 'internal/auth/errors.go', output: '    1\tpackage auth\n    …', ms: 400 })
  thought(kit, id, turn, next(1200), 4000, 'There is no shared retry helper in the repo, so a small internal/retry package is cleaner than inlining a loop in the client.')
  note(kit, id, turn, next(4500), 'No retry helper exists yet. I’ll add a small `internal/retry` package and use it from `Login`.')
  done(kit, id, turn, next(1200), { name: 'write', title: 'Write backoff.go', input: 'internal/retry/backoff.go', files: [file('internal/retry/backoff.go', backoffGo)], ms: 1400 })
  done(kit, id, turn, next(2200), { name: 'edit', title: 'Edit client.go', input: 'internal/auth/client.go', files: [file('internal/auth/client.go', clientGo)], ms: 900 })
  done(kit, id, turn, next(2500), { name: 'edit', title: 'Edit client_test.go', input: 'internal/auth/client_test.go', files: [file('internal/auth/client_test.go', clientTest)], ms: 1100 })
  done(kit, id, turn, next(1800), { name: 'bash', title: 'Run auth tests', input: 'go test ./internal/auth/...', output: goTestFail, status: 'error', ms: 4800 })
  thought(kit, id, turn, next(1200), 9000, 'The second attempt sees an empty body: http.Request.Body is consumed by the first Do. Cloning the request does not reset it. I should call req.GetBody() before each retry. newRequest uses bytes.NewReader, so GetBody is set.')
  done(kit, id, turn, next(9500), { name: 'edit', title: 'Edit client.go', input: 'internal/auth/client.go', files: [file('internal/auth/client.go', clientFix)], ms: 800 })
  done(kit, id, turn, next(1800), { name: 'bash', title: 'Run auth tests', input: 'cd /Users/dev/api-gateway && go test ./internal/auth/... ./internal/retry/...', output: goTestPass, ms: 5200 })
  done(kit, id, turn, next(6000), { name: 'bash', title: 'Vet', input: 'go vet ./...', output: '', ms: 3400 })
  done(kit, id, turn, next(3600), { name: 'bash', title: 'Show the diff stat', input: 'git diff --stat', output: ' internal/auth/client.go      | 20 +++++++++++++++-----\n internal/auth/client_test.go  | 31 +++++++++++++++++++++++++++++++\n internal/retry/backoff.go     | 46 ++++++++++++++++++++++++++++++++++++++++++++++\n 3 files changed, 92 insertions(+), 5 deletions(-)', ms: 400 })
  const answer = kit.msg(id, { role: 'assistant', turn, durationMs: 2 * 60_000 + 10_000, text: loginAnswer }, next(1500))
  answer.updatedAt = next(0)
}

// --- (d) a finished Codex turn with a subagent ---

export function seedCodex(kit: MockKit) {
  const id = WORK_IDS.codex
  let t = kit.nowMs() - 3 * 3600_000
  const next = (ms: number) => (t += ms)
  const user = kit.msg(id, { role: 'user', text: 'Review migration 0042 before we ship it. I’m worried about locking on the orders table.' }, next(0))
  const turn = user.id
  thought(kit, id, turn, next(1200), 3000, 'Check what the migration touches, then hand the lock analysis to a subagent while I read the checkout code that depends on it.')
  done(kit, id, turn, next(3500), { name: 'bash', title: 'Run command', input: '/bin/zsh -lc "sed -n \'1,80p\' db/migrations/0042_checkout_sessions.sql"', output: 'ALTER TABLE orders ADD COLUMN checkout_session_id uuid;\nCREATE INDEX orders_checkout_session_idx ON orders (checkout_session_id);\nALTER TABLE orders ALTER COLUMN checkout_session_id SET NOT NULL;', ms: 300 })
  const agent = done(kit, id, turn, next(1500), {
    name: 'agent', title: 'Review migration 0042 for lock contention', status: 'completed', ms: 41_000,
    agent: {
      name: 'Hume', type: 'explorer', task: 'Review migration 0042 for lock contention', model: 'gpt-5-codex', tools: 6, durationMs: 41_000,
      result: '**Two of the three statements will block writes to `orders`.**\n\n- `CREATE INDEX` without `CONCURRENTLY` holds a `SHARE` lock for the whole build. On 38M rows that is roughly 90 s of blocked inserts.\n- `SET NOT NULL` scans the table under `ACCESS EXCLUSIVE`. Add a `CHECK (… IS NOT NULL) NOT VALID`, validate it, then set `NOT NULL`.\n- `ADD COLUMN` with no default is metadata-only and safe.',
    },
  })
  let c = t + 1000
  const child = (spec: Spec, ms: number) => { done(kit, id, turn, (c += 2500), { ...spec, parent: agent.id, ms }) }
  child({ name: 'bash', title: 'Run command', input: '/bin/zsh -lc "rg -n \'orders\' db/migrations | head -40"', output: 'db/migrations/0007_orders.sql:1:CREATE TABLE orders (\ndb/migrations/0031_orders_status.sql:3:ALTER TABLE orders ADD COLUMN status text;' }, 400)
  child({ name: 'bash', title: 'Run command', input: 'sed -n \'1,60p\' db/migrations/0042_checkout_sessions.sql', output: 'ALTER TABLE orders ADD COLUMN checkout_session_id uuid;' }, 300)
  child({ name: 'bash', title: 'Run command', input: 'sed -n \'1,120p\' db/README.md', output: '# Migrations\n…' }, 300)
  child({ name: 'bash', title: 'Run command', input: 'psql "$REPLICA_URL" -c "select reltuples::bigint from pg_class where relname = \'orders\'"', output: ' reltuples\n-----------\n  38412093\n(1 row)' }, 1800)
  child({ name: 'bash', title: 'Run command', input: 'rg -n "CONCURRENTLY" db/migrations', output: 'db/migrations/0038_events_idx.sql:2:CREATE INDEX CONCURRENTLY events_ts_idx ON events (ts);' }, 350)
  child({ name: 'bash', title: 'Run command', input: 'ls db/migrations | tail -5', output: '0038_events_idx.sql\n0039_events_cleanup.sql\n0040_users_email.sql\n0041_orders_total.sql\n0042_checkout_sessions.sql' }, 200)
  t = c + 41_000 - 15_000
  done(kit, id, turn, next(2000), { name: 'bash', title: 'Run command', input: 'go test ./internal/checkout/...', output: 'ok  \tgithub.com/acme/storefront/internal/checkout\t1.204s', ms: 6000 })
  const answer = kit.msg(id, { role: 'assistant', turn, durationMs: 78_000, text: 'Hold this migration. Two statements lock `orders` for writes:\n\n1. `CREATE INDEX` should be `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction, so it needs its own migration file.\n2. `SET NOT NULL` should follow a `NOT VALID` check constraint and a separate `VALIDATE`, so it avoids the long exclusive lock.\n\nThe checkout code only reads `checkout_session_id` after the backfill, so splitting the migration in three is safe. `go test ./internal/checkout/...` passes against the current schema. I have not changed any files.' }, next(9000))
  answer.updatedAt = t
}

// --- (b) a live turn that keeps streaming ---

interface LiveStep {
  kind: 'thought' | 'note' | 'tool' | 'answer'
  wait: number // pause before it starts
  text?: string
  spec?: Spec
  ms?: number // how long it takes
  result?: Partial<Spec> // what it settles to
}

const redisGo = `@@ -0,0 +1,37 @@
+package session
+
+import (
+	"context"
+	"encoding/json"
+	"time"
+
+	"github.com/redis/go-redis/v9"
+)
+
+// RedisStore keeps sessions in Redis so every API replica sees the same ones.
+type RedisStore struct {
+	rdb *redis.Client
+	ttl time.Duration
+}
+
+func NewRedisStore(rdb *redis.Client, ttl time.Duration) *RedisStore {
+	return &RedisStore{rdb: rdb, ttl: ttl}
+}
+
+func (s *RedisStore) Get(ctx context.Context, id string) (*Session, error) {
+	raw, err := s.rdb.Get(ctx, key(id)).Bytes()
+	if err == redis.Nil {
+		return nil, ErrNotFound
+	}
+	if err != nil {
+		return nil, err
+	}
+	var sess Session
+	return &sess, json.Unmarshal(raw, &sess)
+}
+
+func (s *RedisStore) Put(ctx context.Context, sess *Session) error {
+	raw, _ := json.Marshal(sess)
+	return s.rdb.Set(ctx, key(sess.ID), raw, s.ttl).Err()
+}
+
+func key(id string) string { return "session:" + id }`

const storeEdit = `@@ -12,34 +12,12 @@ import (
-// memStore is the process-local store. It is fine for one replica and
-// wrong for any more: a session created on replica A is unknown to B.
-type memStore struct {
-	mu       sync.RWMutex
-	sessions map[string]*Session
-}
-
-func (m *memStore) Get(ctx context.Context, id string) (*Session, error) {
-	m.mu.RLock()
-	defer m.mu.RUnlock()
-	s, ok := m.sessions[id]
-	if !ok {
-		return nil, ErrNotFound
-	}
-	return s, nil
-}
+// Store is where sessions live. NewRedisStore is the production one;
+// NewMemStore is for tests.
+type Store interface {
+	Get(ctx context.Context, id string) (*Session, error)
+	Put(ctx context.Context, s *Session) error
+}`

const mainEdit = `@@ -44,7 +44,12 @@ func main() {
-	store := session.NewMemStore()
+	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
+	if err := rdb.Ping(ctx).Err(); err != nil {
+		log.Fatalf("redis: %v", err)
+	}
+	store := session.NewRedisStore(rdb, cfg.SessionTTL)
 	srv := api.NewServer(cfg, store)`

function liveScript(): LiveStep[] {
  return [
    { kind: 'tool', wait: 1200, ms: 1100, spec: { name: 'grep', title: 'Search for sync.Map', input: 'sync\\.Map' }, result: { output: 'internal/session/store.go:19:\tsessions sync.Map\ninternal/ratelimit/limiter.go:11:\tbuckets sync.Map' } },
    { kind: 'tool', wait: 700, ms: 800, spec: { name: 'read', title: 'Read main.go', input: 'cmd/server/main.go' }, result: { output: '    44\tstore := session.NewMemStore()\n    45\tsrv := api.NewServer(cfg, store)' } },
    { kind: 'tool', wait: 600, ms: 500, spec: { name: 'read', title: 'Read go.mod', input: 'go.mod' }, result: { output: 'module github.com/acme/orbit-api\n\ngo 1.23\n\nrequire (\n\tgithub.com/redis/go-redis/v9 v9.7.0\n…' } },
    { kind: 'thought', wait: 800, ms: 5200, text: 'go-redis is already a dependency because the rate limiter uses it, so there is nothing new to vendor. The Store interface already has Get and Put, so the swap is one constructor in main. Keep the in-memory store for tests.' },
    { kind: 'note', wait: 300, text: 'go-redis is already a dependency, so I’ll reuse it and keep the `Store` interface as it is.' },
    { kind: 'tool', wait: 900, ms: 1500, spec: { name: 'write', title: 'Write redis.go', input: 'internal/session/redis.go', files: [file('internal/session/redis.go', redisGo)] } },
    { kind: 'tool', wait: 1800, ms: 900, spec: { name: 'edit', title: 'Edit store.go', input: 'internal/session/store.go', files: [file('internal/session/store.go', storeEdit)] } },
    { kind: 'tool', wait: 1500, ms: 800, spec: { name: 'edit', title: 'Edit main.go', input: 'cmd/server/main.go', files: [file('cmd/server/main.go', mainEdit)] } },
    { kind: 'tool', wait: 1200, ms: 4200, spec: { name: 'bash', title: 'Build', input: 'go build ./...' }, result: { output: '' } },
    { kind: 'tool', wait: 900, ms: 3300, spec: { name: 'bash', title: 'Start Redis', input: 'docker compose up -d redis' }, result: { output: ' Container orbit-redis-1  Started' } },
    { kind: 'tool', wait: 800, ms: 9000, spec: { name: 'bash', title: 'Run the session tests', input: 'go test ./internal/session/... -race -count=1' }, result: { status: 'error', output: '--- FAIL: TestRedisStoreExpires (1.01s)\n    redis_test.go:41: session still present after ttl\nFAIL\nFAIL\tgithub.com/acme/orbit-api/internal/session\t1.874s' } },
    { kind: 'thought', wait: 600, ms: 4500, text: 'The test sleeps 1s against a 1s TTL. Redis expires keys lazily with millisecond resolution, so it is racing the clock. Use a 100ms TTL and poll for expiry.' },
    { kind: 'tool', wait: 500, ms: 900, spec: { name: 'edit', title: 'Edit redis_test.go', input: 'internal/session/redis_test.go', files: [file('internal/session/redis_test.go', '@@ -36,8 +36,9 @@ func TestRedisStoreExpires(t *testing.T) {\n-\tstore := NewRedisStore(rdb, time.Second)\n+\tstore := NewRedisStore(rdb, 100*time.Millisecond)\n \tstore.Put(ctx, sess)\n-\ttime.Sleep(time.Second)\n-\tif _, err := store.Get(ctx, sess.ID); err != ErrNotFound {\n+\tdeadline := time.Now().Add(2 * time.Second)\n+\tfor time.Now().Before(deadline) {\n+\t\tif _, err := store.Get(ctx, sess.ID); err == ErrNotFound {\n+\t\t\treturn\n+\t\t}\n+\t\ttime.Sleep(20 * time.Millisecond)\n+\t}\n+\tt.Fatal("session still present after ttl")')] } },
    { kind: 'tool', wait: 900, ms: 26_000, spec: { name: 'bash', title: 'Run all tests', input: 'go test ./... -race -count=1' }, result: { output: 'ok  \tgithub.com/acme/orbit-api/cmd/server\t1.412s\nok  \tgithub.com/acme/orbit-api/internal/api\t6.903s\nok  \tgithub.com/acme/orbit-api/internal/ratelimit\t2.118s\nok  \tgithub.com/acme/orbit-api/internal/session\t1.066s' } },
    { kind: 'answer', wait: 900, text: 'Sessions now live in Redis, so every API replica sees the same ones.\n\n- **`internal/session/redis.go`** adds `RedisStore` behind the existing `Store` interface, with a TTL on every key.\n- **`cmd/server/main.go`** connects with `cfg.RedisAddr` and fails fast if Redis is unreachable.\n- **`internal/session/store.go`** drops the old process-local map; `NewMemStore` stays for tests.\n\nOne test was flaky on the first run (it raced a 1 s TTL), so it now polls for expiry instead of sleeping. `go test ./... -race` passes.\n\nStill to do before deploy: set `REDIS_ADDR` in the staging config.' },
  ]
}

function playLive(kit: MockKit, item: Thread, turn: string, steps: LiveStep[], started: number, onDone: () => void) {
  const id = item.id
  let at = 0
  for (const step of steps) {
    at += step.wait
    if (step.kind === 'thought') {
      const when = at
      kit.later(id, when, () => {
        const m = kit.push(id, { role: 'thought', turn, text: '' })
        const words = (step.text ?? '').split(' ')
        words.forEach((word, index) => kit.later(id, ((step.ms ?? 3000) / words.length) * index, () => kit.update(id, m, { text: m.text + (index ? ' ' : '') + word })))
      })
      at += step.ms ?? 3000
    } else if (step.kind === 'note') {
      kit.later(id, at, () => { kit.push(id, { role: 'assistant', turn, text: step.text ?? '' }) })
    } else if (step.kind === 'tool' && step.spec) {
      const spec = step.spec
      const when = at
      kit.later(id, when, () => {
        const m = kit.push(id, { role: 'tool', turn, text: '', tool: toolOf({ ...spec, status: 'running' }) })
        kit.later(id, step.ms ?? 1000, () => kit.update(id, m, { tool: { ...m.tool!, ...toolOf({ ...spec, ...step.result, status: step.result?.status ?? 'completed' }) } }))
      })
      at += step.ms ?? 1000
    } else if (step.kind === 'answer') {
      kit.later(id, at, () => {
        const m = kit.push(id, { role: 'assistant', turn, text: '' })
        const parts = (step.text ?? '').split(/(\s+)/)
        parts.forEach((part, index) => kit.later(id, 22 * index, () => kit.update(id, m, { text: m.text + part })))
        kit.later(id, 22 * parts.length + 50, () => {
          kit.update(id, m, { durationMs: kit.nowMs() - started })
          kit.touch(item, { status: 'idle' })
          onDone()
        })
      })
    }
  }
}

const liveRuns = new Set<string>()

// startLive (re)starts the live demo: a turn already a minute in, which keeps
// adding steps until it answers, then starts over while someone is watching.
export function startLive(kit: MockKit, item: Thread) {
  if (liveRuns.has(item.id)) return
  liveRuns.add(item.id)
  const run = () => {
    kit.cancelTimers(item.id)
    const now = kit.nowMs()
    kit.messages[item.id] = []
    const user = kit.msg(item.id, { role: 'user', text: 'Our API runs on three replicas but sessions live in process memory, so users get logged out at random. Move session storage to Redis.' }, now - 15_000)
    const turn = user.id
    let t = now - 13_000
    thought(kit, item.id, turn, t, 3500, 'Find where sessions are stored and who constructs the store, then check whether a Redis client is already a dependency.')
    note(kit, item.id, turn, (t += 3600), 'Let me look at how sessions are stored today.')
    done(kit, item.id, turn, (t += 1000), { name: 'grep', title: 'Search for SessionStore', input: 'SessionStore', output: 'internal/session/store.go:14\ninternal/api/server.go:31', ms: 900 })
    done(kit, item.id, turn, (t += 1200), { name: 'read', title: 'Read store.go', input: 'internal/session/store.go', output: '    14\ttype memStore struct {\n    …', ms: 400 })
    done(kit, item.id, turn, (t += 700), { name: 'read', title: 'Read server.go', input: 'internal/api/server.go', output: '    31\tfunc NewServer(cfg Config, store session.Store) *Server {\n    …', ms: 400 })
    done(kit, item.id, turn, (t += 900), { name: 'bash', title: 'List tests', input: 'ls internal/session', output: 'store.go\nstore_test.go', ms: 200 })
    kit.touch(item, { status: 'working' })
    kit.snapshot(item)
    playLive(kit, item, turn, liveScript(), now - 15_000, () => {
      kit.later(item.id, 14_000, () => { if (kit.listening(item.id)) run(); else liveRuns.delete(item.id) })
    })
  }
  run()
}

// --- (c) Claude with parallel subagents, one still running ---

const mapResult = `Found **41 call sites** across 9 packages. Almost all go through the generated \`sqlc\` layer and are parameterised.

Three places build SQL by hand:

- \`internal/orders/search.go:88\` builds an \`ORDER BY\` from the \`sort\` query parameter
- \`internal/reports/export.go:54\` interpolates a table name
- \`internal/admin/audit.go:121\` concatenates a user-supplied filter into a \`WHERE\``

const ormResult = `The ORM's raw-query escape hatch is used in **2 places**, both in \`internal/orders\`:

- \`search.go:88\`: \`db.Raw("... ORDER BY " + sort)\`. Injectable.
- \`refund.go:40\`: uses \`?\` placeholders. Safe.

No other package imports \`db.Raw\`.`

const agentRuns = new Set<string>()

export function startAudit(kit: MockKit, item: Thread) {
  if (agentRuns.has(item.id)) return
  agentRuns.add(item.id)
  kit.cancelTimers(item.id)
  const id = item.id
  const now = kit.nowMs()
  kit.messages[id] = []
  const user = kit.msg(id, { role: 'user', text: 'Audit the storefront API for SQL injection. Map the database calls, check the ORM escape hatches, and write regression tests for anything unsafe.' }, now - 95_000)
  const turn = user.id
  let t = now - 93_000
  thought(kit, id, turn, t, 4000, 'These three jobs are independent, so they can run in parallel: map every call site, check raw-query usage in the ORM layer, and draft tests against whatever turns out to be unsafe.')
  note(kit, id, turn, (t += 4500), 'I’ll split this into three subagents and merge what they find.')
  done(kit, id, turn, (t += 1000), { name: 'grep', title: 'Search for db.Raw', input: 'db\\.Raw', output: 'internal/orders/search.go:88\ninternal/orders/refund.go:40', ms: 800 })

  const mk = (spec: { type: string; task: string; start: number; ms: number; result?: string; tools?: number; status?: 'running' | 'completed' | 'error' }) => {
    const m = done(kit, id, turn, now - spec.start, {
      name: 'agent', title: spec.task, status: spec.status ?? 'completed', ms: spec.ms,
      agent: { type: spec.type, task: spec.task, result: spec.result, tools: spec.tools, durationMs: spec.status === 'running' ? undefined : spec.ms },
    })
    return m
  }
  const a1 = mk({ type: 'Explore', task: 'Map every database call site', start: 88_000, ms: 47_000, result: mapResult, tools: 7 })
  const a2 = mk({ type: 'Explore', task: 'Check ORM raw-query usage', start: 88_000, ms: 31_000, result: ormResult, tools: 4 })
  const a3 = mk({ type: 'general-purpose', task: 'Write regression tests for unsafe queries', start: 87_000, ms: 0, status: 'running' })
  a3.updatedAt = a3.at
  let c1 = now - 86_000
  const kid = (parent: ThreadMessage, spec: Spec, ms = 700) => done(kit, id, turn, (c1 += 2200), { ...spec, parent: parent.id, ms })
  kid(a1, { name: 'grep', title: 'Search for QueryContext', input: 'QueryContext', output: '23 matches' })
  kid(a1, { name: 'grep', title: 'Search for ExecContext', input: 'ExecContext', output: '11 matches' })
  kid(a1, { name: 'grep', title: 'Search for sqlx.', input: 'sqlx\\.', output: '7 matches' })
  kid(a1, { name: 'read', title: 'Read search.go', input: 'internal/orders/search.go', output: '    88\tq := "SELECT … ORDER BY " + sort' })
  kid(a1, { name: 'read', title: 'Read export.go', input: 'internal/reports/export.go', output: '    54\tfmt.Sprintf("SELECT * FROM %s", table)' })
  kid(a1, { name: 'read', title: 'Read audit.go', input: 'internal/admin/audit.go', output: '    121\twhere += " AND " + filter' })
  c1 = now - 85_000
  kid(a2, { name: 'grep', title: 'Search for db.Raw', input: 'db\\.Raw', output: '2 matches' })
  kid(a2, { name: 'read', title: 'Read search.go', input: 'internal/orders/search.go', output: '    88\tdb.Raw("... ORDER BY " + sort)' })
  kid(a2, { name: 'read', title: 'Read refund.go', input: 'internal/orders/refund.go', output: '    40\tdb.Raw("... WHERE id = ?", id)' })
  // The running one: a few finished steps now, more as the demo ticks.
  c1 = now - 80_000
  kid(a3, { name: 'read', title: 'Read search_test.go', input: 'internal/orders/search_test.go', output: '    1\tpackage orders\n    …' })
  kid(a3, { name: 'grep', title: 'Search for func newTestDB', input: 'func newTestDB', output: 'internal/testutil/db.go:17' })
  kid(a3, { name: 'read', title: 'Read db.go', input: 'internal/testutil/db.go', output: '    17\tfunc newTestDB(t *testing.T) *sql.DB {\n    …' })
  kid(a3, { name: 'edit', title: 'Edit search_test.go', input: 'internal/orders/search_test.go', files: [file('internal/orders/search_test.go', '@@ -64,3 +64,19 @@ func TestSearchSorts(t *testing.T) {\n \t}\n }\n+\n+func TestSearchRejectsInjectedSort(t *testing.T) {\n+\tdb := newTestDB(t)\n+\tfor _, sort := range []string{"id; DROP TABLE orders", "id desc, (select 1)", "1 UNION SELECT"} {\n+\t\tif _, err := Search(db, Query{Sort: sort}); !errors.Is(err, ErrBadSort) {\n+\t\t\tt.Errorf("sort %q: want ErrBadSort, got %v", sort, err)\n+\t\t}\n+\t}\n+}')] })
  const extra: { spec: Spec; wait: number; ms: number; output?: string }[] = [
    { spec: { name: 'bash', title: 'Run the new test', input: 'go test ./internal/orders -run TestSearchRejectsInjectedSort' }, wait: 2200, ms: 3800, output: '--- FAIL: TestSearchRejectsInjectedSort (0.02s)\n    search_test.go:70: sort "id; DROP TABLE orders": want ErrBadSort, got <nil>\nFAIL' },
    { spec: { name: 'read', title: 'Read search.go', input: 'internal/orders/search.go' }, wait: 2600, ms: 600, output: '    88\tq := "SELECT … ORDER BY " + sort' },
    { spec: { name: 'bash', title: 'Run the order tests', input: 'go test ./internal/orders/... -race -count=1' }, wait: 3000, ms: 600_000 },
  ]
  let at = 0
  for (const step of extra) {
    at += step.wait
    kit.later(id, at, () => {
      const m = kit.push(id, { role: 'tool', turn, text: '', parentId: a3.id, tool: toolOf({ ...step.spec, status: 'running' }) })
      kit.later(id, step.ms, () => kit.update(id, m, { tool: { ...m.tool!, status: step.output?.startsWith('---') ? 'error' : 'completed', output: step.output ?? '' } }))
    })
    at += Math.min(step.ms, 600)
  }
  // The activity of the parent: it is waiting on the subagents.
  kit.touch(item, { status: 'working' })
  kit.snapshot(item)
}

// stopDemo lets a stopped live demo start over the next time it is opened.
export function stopDemo(id: string) {
  liveRuns.delete(id)
  agentRuns.delete(id)
}
