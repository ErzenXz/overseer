# Skills & Plugins across coding-agent CLIs — research for Overseer

Researched 2026-10-20 on this Mac (macOS, arm64). Read-only: nothing was installed, enabled, disabled or removed, and no prompt was sent to any agent. Test files were created only in a throwaway scratch project (`<scratch>/proj`) to see which agent reads which directory.

Installed and checked live here:

| CLI | Version | Binary |
|---|---|---|
| Claude Code | 2.1.285 | `~/.local/bin/claude` |
| Codex | codex-cli 0.161.0 | `~/.local/bin/codex` |
| Devin CLI | 3000.11.3 | `~/.local/bin/devin` |
| OpenCode | v2.0.32 | `~/.opencode/bin/opencode` |

Not installed (covered from docs only, see Appendix B): Gemini CLI, Cursor Agent, Copilot CLI, Goose, Amp, Kimi, Qwen Code.

Part 1 is the hands-on findings and the recommendation. Appendix A (standards, Claude plugin format, marketplaces and registries) and Appendix B (agents that are not installed) are the detailed web research, merged in unchanged.

---

## 0. Key findings (TL;DR)

1. **Every agent reads `SKILL.md` folders (Agent Skills spec), but they read different directories.** This test project was checked live:

   | Test skill location | Claude Code 2.1.285 | Codex 0.161 | Devin 3000.11 |
   |---|---|---|---|
   | `proj/.claude/skills/demo-skill` | yes (`project`) | **no** (offers to migrate it to `.agents/skills`) | yes (`provider: "Claude"`) |
   | `proj/.agents/skills/shared-skill` | **no** | yes (`scope: "repo"`) | yes (`provider: "Devin"`) |
   | `proj/.codex/skills/codex-proj-skill` | no | yes (`scope: "repo"`) | no |
   | `~/.claude/skills/vercel-doctor` | yes (`user`) | no | yes |

   - OpenCode 2.0's binary scans `~/.config/opencode`, `~/.claude`, `~/.agents` and project `.claude`, `.agents`, `.opencode`, but its `skill.list` API returned an empty list in `--standalone` mode (see §4).
   - **The portable recipe:** keep the canonical copy in `.agents/skills/<name>`, and symlink it into `.claude/skills/<name>`. Claude officially supports symlinked skill folders.
2. **Claude Code has the richest machine surface, and it needs no model tokens:**
   - `claude plugin … --json` covers list, install, uninstall, enable, disable, update, marketplace list and validate. `list --json --available` gives the whole marketplace catalog with `installCount`.
   - The stream-json **control protocol** answers `initialize`, `get_skills_dialog`, `get_hooks_listing`, `mcp_status`, `get_memory_dialog`, `get_settings` and `reload_plugins` without a prompt. This was verified live, and the shapes are in §1.8.
   - Skills are toggled with the settings key **`skillOverrides`**: `{"<skill>": "on"|"name-only"|"user-invocable-only"|"off"}`. Plugin skills cannot be overridden (`locked_by: "plugin"`); disable the whole plugin instead.
3. **Codex has a full JSON-RPC surface** in `codex app-server`:
   - Read and change skills: `skills/list`, `skills/config/write`, `skills/extraRoots/set`.
   - Plugins: `plugin/list|read|install|uninstall|installed|search|reconcile|skill/read|share/*`.
   - Marketplaces: `marketplace/add|remove|upgrade`.
   - Hooks, MCP and config: `hooks/list`, `mcpServerStatus/list`, `config/read|value/write|batchWrite`, `config/mcpServer/reload`.
   - Migrating another agent's setup: `externalAgentConfig/detect|import`.
   - Notification: `skills/changed`.

   All of these were checked live. The CLI also has `codex plugin … --json` and `codex mcp list|get --json`.
4. **Devin CLI reads other agents' setup:**
   - It reads Claude skills, `.claude/commands`, `CLAUDE.md`, Claude hooks and Claude MCP config, plus Cursor and Windsurf rules, `.agents/skills`, and Copilot skills.
   - It loads Claude plugins (`.claude-plugin/plugin.json`) and Agent Plugins.
   - `devin skills list --json` is the only JSON list it has. `plugins` and `mcp` print text only, and `plugins` requires login.
5. **Plugin formats are converging on Claude's `marketplace.json`:**
   - Codex reads `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json`.
   - Codex reads `.codex-plugin/`, `.claude-plugin/` and `.cursor-plugin/plugin.json`. These strings are in the binary.
   - Copilot and Devin read `.claude-plugin/plugin.json`.
   - The Vercel plugin installed here ships `.claude-plugin`, `.cursor-plugin`, `.kimi-plugin` and `.plugin` manifests side by side.
6. **Browsable catalogs:**
   - Claude: `claude plugin list --json --available` returns 314 plugins with install counts, and the official `marketplace.json` lists 315.
   - Codex: `codex plugin list --json --available` returns 6,838 entries, mostly `openai-curated-remote` apps.
   - Public indexes: Gemini gallery JSON (2,198), skills.sh search API, MCP Registry, Smithery, `openai/plugins` (65) and awesome-copilot (182). Details are in Appendix A.
7. **Things to watch out for:**
   - `claude mcp list` / `get` **start and health-check every server**, and have no JSON output. Use `mcp_status` or read the config files instead.
   - Plugin and skill changes need a restart, or `/reload-plugins` / `reload_plugins`.
   - Codex project `.codex/` config and hooks load only for **trusted** projects.

---

## 1. Claude Code (2.1.285)

### 1.1 Extension kinds and locations

| Kind | User | Project | Plugin | Other |
|---|---|---|---|---|
| Skills | `~/.claude/skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` (also nested `<subdir>/.claude/skills`, `--add-dir` dirs) | `<plugin>/skills/<name>/SKILL.md` → `/plugin:skill` | claude.ai-synced: `~/.claude/skills/synced/<bucket>/<name>/` + `manifest.json` (shows as `anthropic-skills:<name>`, source `claude.ai sync`); managed dir; bundled skills (`disableBundledSkills`) |
| Plugin-as-skill-folder | `~/.claude/skills/<name>/.claude-plugin/plugin.json` → id `<name>@skills-dir` (`claude plugin init` scaffolds here) | `.claude/skills/<name>/.claude-plugin/…` | — | — |
| Plugins | installed cache `~/.claude/plugins/cache/<mkt>/<plugin>/<version>/` | enabled per scope via `enabledPlugins` in `.claude/settings.json` / `.claude/settings.local.json` | — | `--plugin-dir`, `--plugin-url` (session only, id `@inline`); synced `~/.claude/plugins/synced/…` (id `@synced`); builtin (`cc-plugin-agents-md@builtin`, `cc-plugin-telemetry@builtin`) |
| Marketplaces | `~/.claude/plugins/known_marketplaces.json` + clone in `~/.claude/plugins/marketplaces/<name>/`; declared in settings `extraKnownMarketplaces` | `extraKnownMarketplaces` in project settings | — | claude.ai-hosted (`--claudeai`), managed `strictKnownMarketplaces` / `blockedMarketplaces` |
| Slash commands (legacy) | `~/.claude/commands/**/*.md` | `.claude/commands/**/*.md` | `<plugin>/commands/` | Skills supersede commands; both show up in `commands` |
| Subagents | `~/.claude/agents/*.md` | `.claude/agents/*.md` | `<plugin>/agents/*.md` → `plugin:agent` | `--agents '<json>'`, built-ins (Explore, Plan, general-purpose…) |
| Output styles | `~/.claude/output-styles/*.md` | `.claude/output-styles/*.md` | `<plugin>/output-styles/` | built-ins; setting `outputStyle` |
| Hooks | `hooks` key in `~/.claude/settings.json` | `.claude/settings.json`, `.claude/settings.local.json` | `<plugin>/hooks/hooks.json` | managed; skill/agent frontmatter `hooks`; `disableAllHooks`, `allowManagedHooksOnly` |
| MCP servers | `~/.claude.json` → `mcpServers` (scope `user`) | `.mcp.json` (scope `project`, needs approval); `~/.claude.json` → `projects[<path>].mcpServers` (scope `local`) | `<plugin>/.mcp.json` or manifest `mcpServers` (named `plugin:<plugin>:<server>`) | claude.ai connectors (`claude.ai <Name>`, type `claudeai-proxy`); `--mcp-config`; managed |
| Memory / rules | `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md` | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md` (frontmatter `paths:`) | plugin-root `CLAUDE.md` is **not** loaded | auto-memory `~/.claude/projects/<slug>/memory/` (`MEMORY.md` index); `cc-plugin-agents-md@builtin` reads `AGENTS.md` |
| Workflows, LSP, monitors, themes | — | `.claude/workflows/` | `<plugin>/.lsp.json`, `monitors/`, `themes/`, `workflows/` | see Appendix A §3 |

Settings scopes, from lowest to highest precedence: user `~/.claude/settings.json`, project `.claude/settings.json`, local `.claude/settings.local.json`, `--settings`, then managed (policy). Remote/managed settings are cached in `~/.claude/remote-settings.json` and `policy-limits.json`. The live merged view comes from the `get_settings` control request (§1.8).

Usage counters: `~/.claude.json` keeps `skillUsage{name:{usageCount,lastUsedAt}}` and `pluginUsage{id:{usageCount,lastUsedAt,lastUsedNumStartups}}`. These are useful for "last used" badges. Read only these keys: the file also holds the OAuth account and caches.

### 1.2 SKILL.md metadata

Spec fields are `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools`. Claude adds `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths` and `shell`; Appendix A §2 has the full table. Real example (Vercel plugin) using free-form `metadata`:
```yaml
---
name: nextjs
description: Next.js App Router expert guidance. Use when building, debugging, …
metadata:
  priority: 5
  docs: ["https://nextjs.org/docs"]
  pathPatterns: ['next.config.*', …]
---
```

### 1.3 Plugin manifest and marketplace files (real examples)

`~/.claude/plugins/cache/claude-plugins-official/vercel/0.50.0/.claude-plugin/plugin.json`:
```json
{"name":"vercel","version":"0.50.0","description":"Build and deploy web apps and agents",
 "author":{"name":"Vercel","url":"https://github.com/vercel"},"repository":"https://github.com/vercel/vercel-plugin",
 "license":"Apache-2.0","keywords":["vercel","nextjs",…],
 "commands":["./commands/bootstrap.md",…],"agents":["./agents/ai-architect.md",…]}
```
- The same plugin folder also holds `.cursor-plugin/plugin.json` (`skills`, `agents`, `commands`, `logo`), `.kimi-plugin/plugin.json` (`skills`, `commands`, `mcpServers`, `interface{displayName, shortDescription, developerName, websiteURL}`) and `.plugin/plugin.json`. This is multi-agent packaging in practice.
- `hooks/hooks.json` registers `SessionStart` (matcher `startup|resume|clear|compact`), `PostToolUse` (matcher `Skill`) and `SessionEnd` command hooks that use `${CLAUDE_PLUGIN_ROOT}`.

State files, read-only:
```jsonc
// ~/.claude/plugins/installed_plugins.json
{"version":2,"plugins":{"vercel@claude-plugins-official":[{"scope":"user","installPath":"…/cache/claude-plugins-official/vercel/0.50.0","version":"0.50.0","installedAt":"2026-08-19T11:17:35.051Z","lastUpdated":"2026-09-22T18:49:25.698Z","gitCommitSha":"882e66c2…"}]}}
// ~/.claude/plugins/known_marketplaces.json
{"claude-plugins-official":{"source":{"source":"github","repo":"anthropics/claude-plugins-official"},"installLocation":"…/marketplaces/claude-plugins-official","lastUpdated":"2026-10-20T10:45:41.214Z"}}
// ~/.claude/settings.json (relevant keys)
{"enabledPlugins":{"vercel@claude-plugins-official":true},
 "extraKnownMarketplaces":{"claude-plugins-official":{"source":{"source":"github","repo":"anthropics/claude-plugins-official"}}}}
```
Synced plugins have a sidecar file, `~/.claude/plugins/synced/<bucket>/<plugin>.meta.json`: `{"server_plugin_id":"plugin_…","marketplace_name":"knowledge-work-plugins","installation_preference":"available"}`.

Undocumented caches (don't depend on them):
- `plugin-catalog-cache.json` holds per-plugin token cost per model and a component inventory.
- `plugin-directory-cache-v2.json` holds 3,604 directory listings with `surfaces: ["claude_code","cowork","claude_ai"]` and review state.

### 1.4 `claude plugin` CLI (verified `--help` on 2.1.285)

| Command | Non-interactive? | JSON |
|---|---|---|
| `claude plugin list [--available] [--data-size [p]]` | yes | `--json` (`--available` requires `--json`) |
| `claude plugin install <p>[@mkt] [-s user\|project\|local] [--config k=v]… [-y] [--accept-command <sha256>] [--registry <url>]` | yes; `-y` is needed when the marketplace declares a command source / headersHelper and there is no TTY | `--json` prints one result line |
| `claude plugin uninstall <p> [-s …] [--keep-data] [--prune -y]` | yes | `--json` (not with `--prune`) |
| `claude plugin enable <p> [-s …]` / `disable [p] [-a] [-s …]` | yes (scope auto-detected) | `--json` |
| `claude plugin update <p> [-s user\|project\|local\|managed] [-y]` | yes; **restart required** | `--json` |
| `claude plugin details <name>` | yes | **no** (text: component inventory and token cost, see below) |
| `claude plugin configure <p> [--values-stdin]` | yes | `--json` |
| `claude plugin validate <path> [--strict]` | yes | `--json` |
| `claude plugin init <name> [--with skills agents hooks mcp lsp output-style channel]` | yes (scaffolds `~/.claude/skills/<name>/`, loads as `<name>@skills-dir`) | no |
| `claude plugin prune [--dry-run] [-y]`, `tag`, `eval` | yes | — |
| `claude plugin marketplace add <src> [--scope] [--sparse …] [--claudeai]` | yes | (Appendix A says `--json`; not in this build's help) |
| `claude plugin marketplace list` | yes | `--json` |
| `claude plugin marketplace remove <name> [--scope]` / `update [name]` | yes | — |

Real output (`claude plugin list --json`):
```json
[{"id":"vercel@claude-plugins-official","version":"0.50.0","scope":"user","enabled":true,
  "installPath":"~/.claude/plugins/cache/claude-plugins-official/vercel/0.50.0",
  "installedAt":"2026-08-19T11:17:35.051Z","lastUpdated":"2026-09-22T18:49:25.698Z",
  "mcpServers":{"vercel":{"type":"http","url":"https://mcp.vercel.com"}},"projectEnabled":false},
 {"id":"cowork-plugin-management@synced","version":"0.2.2","scope":"synced","enabled":true,"installPath":"~/.claude/plugins/synced/<bucket>/cowork-plugin-management"}]
```
`claude plugin list --json --available` returns `{installed:[…], available:[314 × {pluginId, name, description, marketplaceName, source, installCount, version?}]}`. Sources: `url` 163, `git-subdir` 98, relative path string 53. Example:
```json
{"pluginId":"agent-sdk-dev@claude-plugins-official","name":"agent-sdk-dev","description":"Development kit for working with the Claude Agent SDK","marketplaceName":"claude-plugins-official","source":"./plugins/agent-sdk-dev","installCount":67988}
```
`claude plugin marketplace list --json`:
```json
[{"name":"claude-plugins-official","source":"github","repo":"anthropics/claude-plugins-official","installLocation":"~/.claude/plugins/marketplaces/claude-plugins-official"}]
```
`claude plugin details vercel@claude-plugins-official` prints text:
```
Component inventory
  Skills (37)  access-protected-vercel-deployment, ai-gateway, …
  Agents (0)
  Hooks (3)  SessionStart, PostToolUse, SessionEnd  (harness-only — no model context cost)
  MCP servers (1)  vercel
Projected token cost
  Always-on:   ~4,219 tok   added to every session
  component   always-on  on-invoke …
```
The per-skill always-on and on-invoke token estimates are well worth showing in the UI.

### 1.5 MCP (`claude mcp`)

- `claude mcp list`, `claude mcp get <name>`:
  - **Text only.**
  - **They connect to every configured server and health-check it**, which spawns stdio servers. Avoid them for polling.
  - Real output: `plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ! Needs authentication`. `get` shows `Scope: Dynamic config (from command line)`, `Status`, `Type`, `URL`.
- `claude mcp add [-s local|user|project] [-t stdio|sse|http] [-e K=V] [-H 'h: v'] [--client-id] [--callback-port] <name> <cmdOrUrl> [args…]`
- `claude mcp add-json [-s …] <name> '<json>'`
- `claude mcp remove [-s …] <name>`
- `claude mcp add-from-claude-desktop`, `login`, `logout`, `reset-project-choices`, `serve`

Enable and disable:
- Project `.mcp.json` servers need approval. The state lives in `enabledMcpjsonServers` / `disabledMcpjsonServers` (settings, and also per project in `~/.claude.json`) and in `enableAllProjectMcpServers`.
- Runtime toggle: control request `mcp_toggle {serverName, enabled}`.
- Policy keys: `allowedMcpServers` / `deniedMcpServers`.

### 1.6 Subagents, commands, output styles, memory

These are all plain markdown with YAML frontmatter:
- **Subagents:** `name`, `description`, `tools`, `model`, …
- **Commands:** `description`, `argument-hint`, `allowed-tools`, `model`.
- **Output styles:** `name`, `description`.

There is no CLI to list them, but the control protocol lists all of them with their source (§1.8). In the test project, `.claude/agents/demo-agent.md`, `.claude/commands/demo-cmd.md` and `.claude/output-styles/demo-style.md` all showed up.

### 1.7 Skill / plugin toggles (exact keys)

- **One skill:** settings `skillOverrides: {"<name>": "on"|"name-only"|"user-invocable-only"|"off"}`. "Absent = on."
  - `name-only` lists the skill without its description.
  - `user-invocable-only` hides it from the model but keeps `/name`.
  - `off` hides it from both.
  - These are merged across scopes. The `/skills` menu writes to `.claude/settings.local.json`.
  - Plugin skills report `locked_by: "plugin"` and cannot be overridden: toggle the plugin instead.
- **All bundled skills:** `disableBundledSkills: true`, or env `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`.
- **Plugin:** `enabledPlugins["<id>"] = true|false` per scope, or `claude plugin enable|disable -s <scope> --json`.
- **Hooks:** `disableAllHooks`, `allowManagedHooksOnly`. No per-hook toggle key was found; remove the entry instead.
- **Everything at once:** `--safe-mode` / `CLAUDE_CODE_SAFE_MODE=1` turns all customizations off for troubleshooting. `--bare` skips hooks, plugins sync and CLAUDE.md.

### 1.8 Stream-json control protocol (no model tokens; verified live)

Run `claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence`, then write control requests to stdin:
`{"type":"control_request","request_id":"r0","request":{"subtype":"initialize"}}`

Responses come back as `{"type":"control_response","response":{"subtype":"success","request_id":…,"response":{…}}}`. SessionStart hooks run first: `system/hook_started` and `system/hook_response` events are emitted before the response.

Subtypes checked live, all read-only:

| subtype | Response shape (real) |
|---|---|
| `initialize` | `{commands:[{name, description, argumentHint, builtin?, aliases?}], agents:[{name, description, model?}], output_style, available_output_styles:[…], user_output_styles_dir, models:[…], account:{…}, pid, current_permission_mode, …}`. `commands` mixes built-ins, skills and commands. The source is only a suffix in `description` such as `(user)`, `(project)` or `(claude.ai sync)`, or a `(plugin)` prefix: 110 entries here. |
| `get_skills_dialog` | `{skills:[{name, display_name, description, source:"user"\|"project"\|"plugin"\|"claude.ai sync"\|…, tokens, state:"on"\|…, advertised, locked_by?:"plugin", handles:{unqualified_name?, aliases?}}]}`. This is the best skills inventory: 51 non-builtin skills here. |
| `get_hooks_listing` | `{events:[{name, summary, supportsMatcher, hookCount}], hooks:[{event, matcher, source:"pluginHook"\|…, sourceLabel, pluginName?, type, displayText, commandText, contentLabel, timeout?}], eventCatalog, policy}` |
| `mcp_status` | `{mcpServers:[{name, status:"needs-auth"\|"pending"\|"connected"\|…, config:{type,url\|command…}, scope:"dynamic"\|"claudeai"\|"user"\|"project"\|"local", source:"plugin"\|"claudeai"\|…}]}`. claude.ai connectors may still be `pending` at init. |
| `get_memory_dialog` | `{files:[{kind:"user"\|"project"…, path, label, description, exists}], folders:[{kind:"auto", path}], memories:[], auto_memory:{enabled, toggleable, status}, auto_dream:{…}}` |
| `get_settings` | `{effective:{…merged settings…}, sources:[{source:"userSettings"\|…, settings:{…}}], applied:{model, effort, …}}`. **Careful:** this can include `env` values; filter before forwarding. |
| `reload_plugins` | `{commands, agents, plugins:[{name, path, source:"<id>", version?}], mcpServers:[…same as mcp_status…], error_count}`. Reloads in memory; nothing is persisted. |

Other subtypes in the 2.1.285 binary that matter here: `reload_skills`, `reload_output_styles`, `mcp_toggle`, `mcp_reconnect`, `mcp_set_servers`, `mcp_authenticate`, `apply_flag_settings`, `update_settings`, `plugin_install` (an event), `commands_changed` (an event), `list_models`, `get_context_usage`.

**`system/init`:** emitted with the first user turn. It was not triggered here, to avoid spending tokens. Field list taken from the 2.1.285 binary:
```
{type:"system", subtype:"init", cwd, session_id, tools:string[], mcp_servers:[{name,status,source?}], model, permissionMode,
 slash_commands:string[] (user-invocable only), terminal_slash_commands?, apiKeySource, betas, claude_code_version,
 output_style, agents:string[] (agentType names), skills:string[] (user-invocable skill names),
 plugins:[{name, path, source:"<name>@<marketplace>", version?}], plugin_errors?, plugin_warnings?, capabilities?,
 mcp_server_errors?, analytics_disabled, product_feedback_disabled, uuid, memory_paths?, scratchpad_path?, fast_mode_state, effort?, …}
```
So `system/init` gives **names only** for skills, agents and commands. For descriptions, sources and state, use `initialize` and `get_skills_dialog`.

### 1.9 Other

- `claude import [codex|gemini|cursor] [--dry-run] [--yes=<digest>]` imports another agent's MCP servers, AGENTS.md, skills and rules into Claude. Its code reads `~/.agents/skills` and `.agents/skills` as import sources, but it does **not** load them at runtime.
- `claude doctor` reads settings without a trust prompt.

---

## 2. Codex (codex-cli 0.161.0)

### 2.1 Extension kinds and locations

| Kind | User | Project (repo) | Plugin | Other |
|---|---|---|---|---|
| Skills | `~/.agents/skills` (current docs); `$CODEX_HOME/skills` (= `~/.codex/skills`) is still in the binary and used by `$skill-installer` | `.agents/skills` and `.codex/skills`, walking cwd up to the repo root (both verified live, `scope:"repo"`) | `<plugin>/skills/` → name `plugin:skill`, `scope:"user"`, `pluginId` set | `~/.codex/skills/.system/*` (`scope:"system"`: imagegen, openai-docs, review-agent, skill-creator, skill-installer); admin `/etc/codex/skills` (`scope:"admin"`); `skills/extraRoots/set` adds roots for the process |
| Skill sidecar | `<skill>/agents/openai.yaml`: `interface{display_name, short_description, icon_small, icon_large, brand_color, default_prompt}`, `policy{allow_implicit_invocation}`, `dependencies{tools[]}` | | | |
| Plugins | `[plugins."<name>@<mkt>"] enabled = true` in `~/.codex/config.toml`; cache `~/.codex/plugins/cache/<mkt>/<plugin>/<version>/` | marketplace in repo `.agents/plugins/marketplace.json` (also reads `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json`) | manifest `.codex-plugin/plugin.json` (also `.claude-plugin/` and `.cursor-plugin/plugin.json`, Agent Plugins root `plugin.json`); components `skills`, `mcpServers` (`.mcp.json`), `apps` (`.app.json`), `hooks` | remote catalog `openai-curated-remote` (ChatGPT apps/connectors; `features.remote_plugin`) |
| Marketplaces | `[marketplaces.<name>] source_type="local"\|"git", source, ref, sparse_paths` | repo `.agents/plugins/marketplace.json` | | here: `openai-bundled` (`~/.codex/.tmp/bundled-marketplaces/…`), `openai-primary-runtime` (`~/.cache/codex-runtimes/…`), `openai-curated` (`~/.codex/.tmp/plugins`) |
| Custom prompts | `~/.codex/prompts/*.md` (**deprecated**; no references left in the 0.161 binary; use skills) | — | — | — |
| Subagents / roles | `[agents]` config (`enabled`, `max_concurrent_threads_per_session`, `default_subagent_model`, …); role files `.codex/agents/` (the migration target for Claude `.claude/agents`) | `.codex/agents/` | — | binary has "agent role" with `nickname_candidates` |
| Hooks | `~/.codex/hooks.json`, `[hooks]` in config.toml | `.codex/hooks.json`, `.codex/config.toml` (**trusted projects only**) | plugin `hooks/hooks.json` | trust state per hook: `hooks.state."<key>".trusted_hash` (written with `config/batchWrite`); `features.hooks` |
| MCP | `[mcp_servers.<name>]` in `~/.codex/config.toml` (`enabled`, `enabled_tools`, `disabled_tools`, …) | `.codex/config.toml` (trusted only) | plugin `.mcp.json`; `plugins."id".mcp_servers.<s>.enabled` | `codex_apps` (ChatGPT connectors, bearer auth) |
| Memory / rules | `~/.codex/AGENTS.md` (or `AGENTS.override.md`) | `AGENTS.override.md` → `AGENTS.md` → `project_doc_fallback_filenames`, per dir from the repo root down to cwd | — | `[memories]`, `features.memories` |
| Config | `~/.codex/config.toml`, `profiles` | `.codex/config.toml` (trusted) | — | `/etc/codex/config.toml` (system), MDM / managed, `requirements.toml` |

### 2.2 CLI (non-interactive, verified `--help`)

| Command | JSON |
|---|---|
| `codex mcp list` | `--json` |
| `codex mcp get <name>` | `--json` |
| `codex mcp add <name> (--url URL [--bearer-token-env-var V] [--oauth-client-id …] [--oauth-resource …] \| [--env K=V] -- <cmd>…)` | no |
| `codex mcp remove <name>`, `login`, `logout` | no |
| `codex plugin list [-m MKT] [--available]` | `--json` |
| `codex plugin add <p[@mkt]> [-m MKT]` | `--json` |
| `codex plugin remove <p[@mkt]> [-m MKT]` | `--json` |
| `codex plugin marketplace add <path\|owner/repo[@ref]\|https\|ssh> [--ref] [--sparse PATH]…` | `--json` |
| `codex plugin marketplace list` / `upgrade [name]` / `remove <name>` | `--json` |
| `codex features list` / `enable <f>` / `disable <f>` | no |

- There is **no `codex plugin enable/disable`**. Toggle with `config/value/write` on `plugins."<id>".enabled`, or by editing config.toml.
- There is **no `codex skills` CLI**. Use the app-server.

Real output, `codex mcp list --json` (`env` values redacted; the CLI prints `env_vars` names only):
```json
[{"name":"code-review","enabled":false,"disabled_reason":null,
  "transport":{"type":"stdio","command":"/bin/sh","args":["-c","exec \"$CODEX_MCP_NODE_PATH\" ./server.mjs \"$@\"","--"],"env":null,"env_vars":["PATH","GH_TOKEN",…],"cwd":"~/.codex/plugins/cache/openai-bundled/code-review/26.1013.40934/."},
  "startup_timeout_sec":null,"tool_timeout_sec":120.0,"auth_status":"unsupported"}, …]
```
`codex plugin list --json` (`--available` adds an `available` array; 6,838 entries here, 6,834 of them remote apps):
```json
{"installed":[{"pluginId":"documents@openai-primary-runtime","name":"documents","marketplaceName":"openai-primary-runtime","version":"26.1017.22136",
  "installed":true,"enabled":true,"source":{"source":"local","path":"~/.cache/codex-runtimes/…/plugins/documents"},
  "marketplaceSource":{"sourceType":"local","source":"…"},"installPolicy":"AVAILABLE","authPolicy":"ON_USE"}, …]}
```
`codex plugin marketplace list --json`:
```json
{"marketplaces":[{"name":"openai-primary-runtime","root":"…","marketplaceSource":{"sourceType":"local","source":"…"}},
                 {"name":"openai-bundled","root":"~/.codex/.tmp/bundled-marketplaces/openai-bundled",…},{"name":"openai-curated","root":"~/.codex/.tmp/plugins"}]}
```
Marketplace file (`<root>/.agents/plugins/marketplace.json`):
```json
{"name":"openai-bundled","interface":{"displayName":"OpenAI Bundled"},
 "plugins":[{"name":"browser","source":{"source":"local","path":"./plugins/browser"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Engineering"}, …]}
```
Plugin manifest (`.codex-plugin/plugin.json`), excerpt:
```json
{"name":"pdf","version":"26.1017.22136","description":"…","author":{…},"license":"MIT","keywords":[…],"skills":"./skills/",
 "interface":{"displayName":"PDF","shortDescription":"…","longDescription":"…","developerName":"OpenAI","category":"Productivity",
   "capabilities":["Interactive","Write"],"websiteURL":"…","privacyPolicyURL":"…","termsOfServiceURL":"…","defaultPrompt":[…],
   "brandColor":"#…","composerIcon":"./assets/icon.svg","logo":"…","logoDark":"…"}}
```
The `interface` block is the best UI metadata of any agent: logos, brand color, category and capabilities.

### 2.3 app-server JSON-RPC (generated with `codex app-server generate-json-schema [--experimental] --out <dir>`; checked live)

- **Transport and setup:** `codex app-server --listen stdio://`. Send `initialize {clientInfo:{name,version}, capabilities:{experimentalApi:true}}`, then the `initialized` notification.
- **Counts:** the stable schema has 104 client methods; the experimental one has 169.

| Method | Params → Result |
|---|---|
| `skills/list` | `{cwds?: string[], forceReload?: bool}` → `{data:[{cwd, skills: SkillMetadata[], errors:[{path,message}]}]}` |
| `skills/config/write` | `{enabled: bool, name?: string, path?: abs}` → `{effectiveEnabled: bool}` (persists `[[skills.config]]`) |
| `skills/extraRoots/set` | `{extraRoots: string[]}` → `{}` (process-level) |
| `hooks/list` | `{cwds?}` → `{data:[{cwd, hooks: HookMetadata[], warnings, errors}]}` |
| `plugin/list` | `{cwds?, forceRefetch?, marketplaceKinds?: ("local"\|"vertical"\|"workspace-directory"\|"shared-with-me"\|"created-by-me-remote")[]}` → `{marketplaces:[{name, path?, interface?:{displayName?}, plugins: PluginSummary[]}], marketplaceLoadErrors?, featuredPluginIds?}` |
| `plugin/installed` | `{cwds?, installSuggestionPluginNames?}` → same shape as `plugin/list` |
| `plugin/read` | `{pluginName, marketplacePath? \| remoteMarketplaceName?}` → `{plugin:{marketplaceName, marketplacePath?, summary: PluginSummary, description?, skills: SkillSummary[], onboardingSkill?, hooks:[{eventName,key}], apps, appTemplates, mcpServers: string[], scheduledTasks?, shareUrl?}}` |
| `plugin/install` | `{pluginName, marketplacePath? \| remoteMarketplaceName?, installAttemptId?}` → `{authPolicy:"ON_INSTALL"\|"ON_USE", appsNeedingAuth: AppSummary[]}` |
| `plugin/uninstall` | `{pluginId}` → `{}` |
| `plugin/search` (exp.) | `{searchTerm, scope?:"global"\|"workspace"\|"personal", cursor?, limit?, cwds?}` → `{data:[{marketplaceName, marketplacePath?, plugin: PluginSummary}], nextCursor?}` |
| `plugin/reconcile` | `{reason?}` → `{changedPlugins:[{id, hasSkills, hasHooks, hasMcps, hasApps}], failedRemotePluginIds, failedMaterializationRemotePluginIds}` |
| `plugin/skill/read` | `{remoteMarketplaceName, remotePluginId, skillName}` → `{contents?}` |
| `plugin/share/save\|list\|checkout\|delete\|updateTargets` | share local plugins to ChatGPT workspace principals (`discoverability: LISTED\|UNLISTED\|PRIVATE`) |
| `marketplace/add` | `{source, refName?, sparsePaths?}` → `{marketplaceName, installedRoot, alreadyAdded}` |
| `marketplace/remove` | `{marketplaceName}` → `{marketplaceName, installedRoot?}` |
| `marketplace/upgrade` | `{marketplaceName?}` → `{selectedMarketplaces, upgradedRoots, errors[]}` |
| `mcpServerStatus/list` | `{detail?: "full"\|"toolsAndAuthOnly", serverName?, threadId?, cursor?, limit?}` → `{data:[{name, authStatus:"unknown"\|"unsupported"\|"notLoggedIn"\|"bearerToken"\|"oAuth", runtimeStatus?, tools:{…}, resources, resourceTemplates, pluginId?, serverInfo?, toolsError?}], nextCursor?}` (`detail:"summary"` is rejected) |
| `config/mcpServer/reload` | → `{}` |
| `config/read` | `{cwd?, includeLayers?}` → `{config, origins:{"<key.path>":{name: ConfigLayerSource, version}}, layers?:[{name, config, version, disabledReason?}]}` |
| `config/value/write` | `{keyPath, value, mergeStrategy:"replace"\|"upsert", filePath?, expectedVersion?}` → `{filePath, status, version, overriddenMetadata?}` |
| `config/batchWrite` | `{edits:[{keyPath, value, mergeStrategy}], filePath?, expectedVersion?, reloadUserConfig?}` |
| `experimentalFeature/list` / `experimentalFeature/enablement/set` | `{data:[{name, stage:"stable"\|"beta"\|"underDevelopment"\|"deprecated"\|"removed", enabled, defaultEnabled, displayName?, description?}]}` |
| `externalAgentConfig/detect` / `import` | detect `{cwds?, includeHome?, source?}` → `{items:[{itemType:"AGENTS_MD"\|"CONFIG"\|"SKILLS"\|"PLUGINS"\|"MCP_SERVER_CONFIG"\|"SUBAGENTS"\|"HOOKS"\|"COMMANDS"\|"MEMORY"\|"SESSIONS", description, cwd?, details}], connectors?}` |
| `app/list`, `app/read`, `app/installed` | ChatGPT connectors (`AppInfo{id, name, description, logoUrl, isEnabled, isAccessible, pluginDisplayNames, installUrl, …}`) |
| Notifications | `skills/changed` (empty payload: re-query), `app/list/updated`, `mcpServer/startupStatus/updated`, `mcpServer/oauthLogin/completed`, `hook/started`, `hook/completed`, `externalAgentConfig/import/progress\|completed`, `configWarning` |

Key types:
```ts
SkillMetadata = {name, description, shortDescription?, interface?: {displayName?, shortDescription?, iconSmall?, iconLarge?, iconSmallUrl?, iconLargeUrl?, brandColor?, defaultPrompt?},
                 dependencies?: {tools: {type, value, description?, transport?, command?, url?}[]}, path, scope: "user"|"repo"|"system"|"admin", enabled, pluginId?}
PluginSummary = {id, name, version?, localVersion?, remotePluginId?, source: {type:"local",path}|{type:"git",url,path?,refName?,sha?}|{type:"npm",package,version?,registry?}|{type:"remote"},
                 installed, installedAt?, enabled, installPolicy: "NOT_AVAILABLE"|"AVAILABLE"|"INSTALLED_BY_DEFAULT", installPolicySource?, authPolicy: "ON_INSTALL"|"ON_USE",
                 availability?: "AVAILABLE"|"DISABLED_BY_ADMIN", disabledReason?: "disabled_by_admin"|"plan_not_eligible"|"required_app_unavailable"|"unknown",
                 eligiblePlanTypes?, interface?: PluginInterface, keywords?, shareContext?, mustShowInstallationInterstitial?}
HookMetadata  = {key, eventName: "preToolUse"|"permissionRequest"|"postToolUse"|"preCompact"|"postCompact"|"sessionStart"|"sessionEnd"|"userPromptSubmit"|"subagentStart"|"subagentStop"|"stop"|"interrupt",
                 handlerType: "command"(command, async?)|"mcpTool"(server, tool)|"prompt"|"agent", matcher?, source: "system"|"user"|"project"|"mdm"|"sessionFlags"|"plugin"|"cloudRequirements"|…,
                 sourcePath, pluginId?, enabled, isManaged, trustStatus: "managed"|"untrusted"|"trusted"|"modified", currentHash, timeoutSec, statusMessage?, displayOrder}
```

Real `skills/list` entries (test project):
```
repo   codex-proj-skill   enabled  (.codex/skills)
repo   shared-skill       enabled  (.agents/skills)
user   pdf:pdf            enabled  pluginId=pdf@openai-primary-runtime  (has interface)
system imagegen           enabled  (~/.codex/skills/.system/imagegen)
```
```json
{"name":"pdf:pdf","description":"Read, create, inspect, render, and verify PDF files …","interface":{"displayName":"PDF","shortDescription":"Read, create, render, and verify PDF files",
 "iconSmall":"~/.codex/plugins/cache/openai-primary-runtime/pdf/26.1017.22136/skills/pdf/assets/file-document.png","brandColor":"#DC2626",
 "defaultPrompt":"Use $pdf to read, create, render, or visually verify a PDF file."},"path":"…/SKILL.md","scope":"user","enabled":true,"pluginId":"pdf@openai-primary-runtime"}
```
`externalAgentConfig/detect` on the test project offered: `SKILLS`, "Migrate skills from proj/.claude/skills to proj/.agents/skills", and `SUBAGENTS`, ".claude/agents → .codex/agents". This is a built-in share/migrate path.

`config/read` with `includeLayers` showed:
- the project layer `proj/.codex` with `disabledReason: "To load project-local config, hooks, and exec policies, add … as a trusted project in ~/.codex/config.toml."`
- user `~/.codex/config.toml`
- system `/etc/codex/config.toml`

Caveats:
- The docs flag the plugin methods as under development ("don't call `plugin/list` from production clients yet").
- Skill toggles and new plugins apply to new threads. `skills/changed` fires when the watched skill files change.

---

## 3. Devin CLI (3000.11.3)

### 3.1 Locations (from `devin skills paths`, `devin rules paths` and the bundled docs at `~/.local/share/devin/cli/_versions/<v>/share/devin/docs/`)

| Kind | User | Project | Also imports from other agents |
|---|---|---|---|
| Skills | `~/.config/devin/skills/<n>/SKILL.md`, `~/.config/cognition/skills/`, `~/.agents/skills/`, `~/.codeium/<channel>/skills/` | `.devin/skills/`, `.cognition/skills/`, `.agents/skills/`, `.windsurf/skills/` | `.claude/skills/**/SKILL.md`, `~/.claude/skills` (verified), `.claude/commands/**/*.md` as skills, Copilot `.github/skills`, `~/.copilot/skills` |
| Rules / memory | `~/.config/devin/AGENTS.md` (or `AGENT.md`), `~/.devin/rules/*.md`, `~/.devin/global_rules.md`, `~/.claude/CLAUDE.md` | `AGENTS.md`, `AGENTS.local.md`, `AGENT.md`, `CLAUDE.md`, `.windsurfrules`, `.devin/rules/*.md`, `.devin/global_rules.md`, `.windsurf/rules/*.md`, `.cursor/rules/*.md(c)` | rule frontmatter `trigger: always_on\|manual\|model_decision\|agent\|glob` (Windsurf) or `alwaysApply/globs/description` (Cursor) |
| Plugins | personal manifest in Devin Cloud (synced across machines), or `--local` links | — | manifests `.devin-plugin/plugin.json` > `.claude-plugin/plugin.json` > root `plugin.json` (Agent Plugins 1.0.0) |
| Subagents | `~/.config/devin/agents/<n>.md` or `<n>/AGENT.md` | `.devin/agents/`, `.agents/agents/` | plugin `agents/` → `plugin:name` |
| Hooks | `~/.config/devin/config.json` `"hooks"`, plus `~/.claude.json` and `~/.claude/settings(.local).json` | `.devin/hooks.v1.json` (the whole file is the hooks object), `.devin/config(.local).json`, `.claude/settings(.local).json` | `devin migrate hooks` (Windsurf) |
| MCP | `~/.config/devin/mcp_config.json` | `.devin/mcp_config.json` (project), `.devin/mcp_config.local.json` (local, gitignored) | reads `.mcp.json`, Claude settings and `~/.claude.json`, `.cursor/mcp.json`, Windsurf, OpenCode, Zed |
| Import switches | `read_config_from: {agents_standard, cursor, windsurf, claude}` in `~/.config/devin/config.json` or `.devin/config.json` | | |

Skill frontmatter: `name`, `description`, `argument-hint`, `model`, `subagent`, `agent`, `allowed-tools` (list), `permissions{allow,deny,ask}`, `triggers: [user, model]`.

Plugin manifest: `name` (the only required field), `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `skills`, `requiredPlugins`, `optionalPlugins`, `forbiddenPlugins`.

### 3.2 CLI

| Command | Notes | JSON |
|---|---|---|
| `devin skills list [--trigger user\|model]` | | `--json` |
| `devin skills show <name>`, `devin skills paths` | text | no |
| `devin rules list [--provider cursor\|windsurf]`, `show`, `paths` | text | no |
| `devin plugins install <owner/repo[#path]\|git-url\|./path> [-y] [--local]` | **requires `devin auth login`**; without `--local` it records the plugin in the cloud personal manifest | no |
| `devin plugins list` / `info <name>` / `update [name]` / `remove <name> [--local] [--force] [-y]` / `prune` | login required ("You must be logged in to manage plugins") | no |
| `devin mcp add [-s local\|project\|user] [-t stdio\|sse\|http] <name> <url> \| -- <cmd…>` | `-e K=V`, `-H 'h: v'` | no |
| `devin mcp list`, `get`, `remove [-s]`, `enable [-s]`, `disable [-s]` (sets `"disabled": true`), `login`, `logout` | | no |
| `devin migrate hooks\|workflows` | | |
| `devin acp` | ACP server: slash commands arrive through ACP `available_commands_update` | |

Real `devin skills list --json`, test project:
```json
[{"name":"vercel-doctor","description":"Find ways to cut your Vercel bill. …","triggers":["user","model"],"provider":"Claude","base_dir":"~/.claude/skills/vercel-doctor","display_name":"vercel-doctor","warnings":[],"errors":[]},
 {"name":"shared-skill","description":"Shared .agents skill for research.","triggers":["user","model"],"provider":"Devin","base_dir":"…/proj/.agents/skills/shared-skill",…},
 {"name":"demo-skill",…,"provider":"Claude","base_dir":"…/proj/.claude/skills/demo-skill",…},
 {"name":"devin-cli","triggers":["model"],"provider":"Builtin",…}]
```
`devin rules list` (text): `CLAUDE [Claude] always-on`, `global_rules [Windsurf] always-on`, `AGENTS [Standard] always-on`.

Devin has no per-skill disable setting. Use `triggers: [user]` in frontmatter to stop the model invoking a skill, or turn off whole providers with `read_config_from`.

---

## 4. OpenCode (v2.0.32)

- **Architecture:** a background service plus an HTTP API. `opencode api <operationId | METHOD path> [--standalone]` calls it, and the spec is at `GET /openapi.json` (119 paths: "Experimental HttpApi surface").
- **Relevant operations:**
  - `skill.list` (GET /api/skill): `Skill.Info{id, name, description?, autoinvoke?, path, content}`
  - `command.list`: `{name, description?}`
  - `agent.list`, `agent.get`
  - `plugin.list`: `Plugin.Info{id?, source, features, state}`
  - `plugin.check`, `plugin.update`
  - `mcp.list`
  - `experimental.mcp.add|remove|connect|disconnect` (PUT/DELETE/POST /api/experimental/mcp/{server})
  - `config.get`, `experimental.config.update` (PATCH)
  - `location.reload`
  - `experimental.session.skill` (activate a skill in a session)
  - `rpc.call` (plugin RPC)
- **Live test:**
  - `opencode debug agents` (JSON) listed the project's `.opencode/agents/oc-agent.md` as `mode:"subagent"`, next to the built-ins: build, plan, explore, general, compaction, summary and title.
  - `opencode api skill.list --standalone` and `command.list` returned `data: []` even though `.opencode/skills`, `.opencode/commands` and `~/.claude/skills` exist. This is either a standalone-mode quirk or skills load lazily per session. **Verify against the running service before relying on it.**
- **CLI:**
  - `opencode plugin list [--builtin]`, `plugin add <npm-or-git-spec>` (global config), `plugin remove <spec>`, `plugin check [target]`, `plugin update`. Output is text ("No plugins found").
  - `opencode mcp list` (text), `mcp add <name> [--url URL] [--header k=v] [--env k=v] [--global] [-- cmd…]`, `mcp auth`, `mcp logout`.
  - `opencode debug config` (JSON list of config sources), `debug paths`, `reload`, `acp`.
- **Locations:**
  - Config: `~/.config/opencode/opencode.json[c]` (plus its own `node_modules` for npm plugins) and project `opencode.json` / `.opencode/`.
  - From the binary: globs `{command,commands}/**/*.md`, `{agent,agents}/**/*.md`, `{mode,modes}/*.md`. Skill roots are `~/.config/opencode`, `~/.claude`, `~/.agents` and project `.claude`, `.agents`, `.opencode`, scanned for `{*.md,**/SKILL.md}` with symlinks followed.
  - Skill metadata keys `opencode/autoinvoke` and `disable-model-invocation`.
  - There is also a remote "skill index" fetcher, which caches into `<cache>/skills/<hash>/<name>/` with an `.opencode-version` file.
  - Data: `~/.local/share/opencode` (db `opencode.db`).
- **Skill permissions:** `opencode.json` → `permission.skill` patterns (`allow|deny|ask`). This is the closest thing to a disable switch.

---

## 5. Gemini CLI, Cursor, Copilot, Goose, Amp, Kimi, Qwen (not installed: docs only)

Appendix B has the full detail. Highlights:

- **Gemini CLI** (being replaced by Antigravity `agy` for consumer plans since 2026-06-18):
  - `gemini extensions list -o json` (JSON), plus `install`, `uninstall`, `enable`, `disable [--scope]`, `update`, `link`, `new`, `config`.
  - Extensions live in `~/.gemini/extensions/<n>/gemini-extension.json`. Enablement is in `~/.gemini/extensions/extension-enablement.json`, as path-override rules.
  - Skills: `gemini skills list|install|uninstall`, read from `~/.gemini/skills`, `.gemini/skills` and `.agents/skills`.
  - Commands are `.toml` files in `~/.gemini/commands` and `.gemini/commands`.
  - Memory is `GEMINI.md`. MCP lives in `settings.json`, with enablement in `~/.gemini/mcp-server-enablement.json`.
  - Gallery JSON: `https://geminicli.com/extensions.json`.
- **Copilot CLI:** the most complete JSON CLI after Claude and Codex: `copilot plugin list --json`, `plugin marketplace list|browse --json`, `skill list --json`, `mcp list|get --json`, `instruction list --json`. Plugins install to `~/.copilot/installed-plugins/<mkt>/<p>`, and it reads `.claude-plugin`, `.claude/skills` and `.claude/agents`.
- **Cursor Agent:** plugin install is interactive only (`/plugin`). It has `agent mcp list` / `enable` / `disable` but no add or remove. It reads `.agents/skills`, `.cursor/skills`, `.claude/skills` and `.codex/skills`, and its rules are `.cursor/rules/*.mdc`.
- **Goose:** extensions are MCP servers in `~/.config/goose/config.yaml`. It added `goose plugin install/update` (which accepts Gemini extensions), reads `.agents/skills`, and has recipes.
- **Amp:** `amp skills list --json`. Plugins are TypeScript files in `.amp/plugins` and `~/.config/amp/plugins`. MCP is configured in `amp.mcpServers` in settings.
- **Kimi Code** (successor to kimi-cli): config in `~/.kimi-code/`. Plugins, MCP and skills are managed only from the TUI.
- **Qwen Code:** `qwen extensions …` installs Claude marketplace plugins and Gemini extensions. `qwen mcp add|remove|list` prints text. Memory is `QWEN.md`.

---

## 6. Cross-agent standards and sharing (summary; details in Appendix A)

- **Agent Skills spec (agentskills.io):**
  - Layout: `<name>/SKILL.md` plus optional `scripts/`, `references/`, `assets/`.
  - Frontmatter: `name` (1–64 chars `[a-z0-9-]`, must equal the dir name) and `description` (1–1024 chars) are required. `license`, `compatibility`, `metadata` (string map) and `allowed-tools` (space-separated string) are optional.
  - Validate with `skills-ref validate <dir>`, or `claude plugin validate <dir> --json`.
- **Shared directories:**
  - `.agents/skills` / `~/.agents/skills` is read by Codex, Devin, Gemini, Cursor, OpenCode, Copilot, Goose, Amp and Kimi Code.
  - `.claude/skills` is read by Claude, Devin, OpenCode, Cursor, Copilot, Goose and Amp.
  - So a `.agents/skills` canonical copy plus a symlink in `.claude/skills` reaches every agent covered here. This is also what `npx skills add` does by default.
  - Claude docs explicitly allow a symlinked skill folder and dedupe the target. Codex follows symlinks. OpenCode scans with `symlink: true`.
  - Caution: Claude's own `import` code skips a project `.agents/` path that is or sits under a symlink "for safety". Prefer symlinking *into* `.claude/skills`, not making `.agents` itself a symlink.
- **Plugin format families:**
  - Claude: `.claude-plugin/{plugin,marketplace}.json`. This is the de facto marketplace format, and Codex, Copilot, Devin and `npx skills` all read it.
  - Agent Plugins 1.0.0: root `plugin.json`, `skills/`, `mcp.json`. Supported by Codex, Cursor, Copilot, Kiro, VS Code and Devin; not by Claude Code.
  - Vendor variants: `.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.devin-plugin`, `gemini-extension.json`, `qwen-extension.json`.
- **Browsable indexes:**

  | Index | Endpoint | Entries |
  |---|---|---|
  | Claude official marketplace | `https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json`, or via `claude plugin list --json --available` with `installCount` | 315 |
  | anthropics/skills | `https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json` | 5 bundles |
  | OpenAI curated | `https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json` | 65 |
  | Gemini gallery | `https://geminicli.com/extensions.json` | 2,198 |
  | skills.sh search | `https://skills.sh/api/search?q=` | search only |
  | MCP Registry | `https://registry.modelcontextprotocol.io/v0.1/servers` | — |
  | Smithery | `https://registry.smithery.ai/servers?q=` | — |
  | Copilot awesome-copilot | `github/awesome-copilot` `.github/plugin/marketplace.json` | 182 |

---

## 7. Recommended unified data model for the "Skills & Plugins" page

The record is per device and per agent, gathered by the device agent (the hub's node process), and normalised by kind.

```ts
type ExtKind = 'skill' | 'plugin' | 'marketplace' | 'command' | 'subagent' | 'rule' | 'hook' | 'extension' | 'mcp_server' | 'output_style';
type ExtScope = 'user' | 'project' | 'local' | 'plugin' | 'managed' | 'system' | 'builtin' | 'synced' | 'session';
//  local   = Claude settings.local / Devin *.local.json / Claude ~/.claude.json projects[path]
//  system  = Codex .system skills, /etc/codex
//  synced  = claude.ai sync, Devin cloud manifest
//  session = --plugin-dir, extraRoots

interface ExtItem {
  key: string;                 // stable: `${deviceId}:${agent}:${kind}:${scope}:${qualifiedName}[:${projectPath}]`
  deviceId: string;
  agent: 'claude'|'codex'|'devin'|'opencode'|'gemini'|'copilot'|'cursor'|'goose'|'amp'|'kimi'|'qwen';
  kind: ExtKind;
  name: string;                // unqualified, e.g. "nextjs"
  qualifiedName: string;       // as the agent invokes it: "vercel:nextjs", "pdf:pdf", "plugin:vercel:vercel"
  displayName?: string;        // Codex interface.displayName, Claude displayName
  description?: string;
  scope: ExtScope;
  projectPath?: string;        // for project/local scope
  path?: string;               // SKILL.md / agent .md / manifest / config file that defines it
  sourceFile?: string;         // the config file holding the enable flag (settings.json, config.toml, mcp_config.json)
  provider?: string;           // the format family it came from (Devin "provider": Claude|Devin|Builtin; or 'agents-standard')
  parentId?: string;           // plugin id for plugin-provided items; marketplace name for plugins
  version?: string;
  enabled: boolean | null;     // null = no toggle concept
  state?: 'on'|'off'|'name-only'|'user-invocable-only'|'needs-auth'|'pending'|'error'|'untrusted'|'disabled_by_admin';
  lockedBy?: 'plugin'|'policy'|'hook'|'pin';   // Claude locked_by; Codex isManaged / DISABLED_BY_ADMIN
  invocation?: { user: boolean; model: boolean; argumentHint?: string };   // user-invocable / disable-model-invocation / triggers / allow_implicit_invocation
  ui?: { icon?: string; iconUrl?: string; brandColor?: string; category?: string; capabilities?: string[]; defaultPrompt?: string[] };
  cost?: { alwaysOnTokens?: number; onInvokeTokens?: number };   // Claude plugin details / get_skills_dialog.tokens
  usage?: { count?: number; lastUsedAt?: string };               // Claude ~/.claude.json skillUsage/pluginUsage
  source?: { type: 'github'|'git'|'git-subdir'|'url'|'npm'|'local'|'archive'|'remote'|'command'; repo?: string; url?: string; path?: string; ref?: string; sha?: string; package?: string };
  install?: { installedAt?: string; lastUpdated?: string; installPath?: string; installCount?: number; installPolicy?: string; authPolicy?: string };
  mcp?: { transport: 'stdio'|'http'|'sse'|'ws'|'claudeai-proxy'; command?: string; url?: string; authStatus?: string; toolCount?: number };  // never env/header values
  hook?: { event: string; matcher?: string; handlerType: string; command?: string; trust?: 'trusted'|'untrusted'|'modified'|'managed' };
  sharedWith?: string[];       // other agents that read the same file (computed: same realpath seen by several agents)
  errors?: string[]; warnings?: string[];
}

interface CatalogEntry {      // browse, not installed
  catalog: 'claude-marketplace'|'codex-marketplace'|'gemini-gallery'|'skills.sh'|'mcp-registry'|'smithery'|'copilot-marketplace';
  agentTargets: string[];      // which agents can install it
  id: string; name: string; description?: string; category?: string; installCount?: number; stars?: number;
  source: ExtItem['source']; marketplaceName?: string; hasSkills?: boolean; hasMCP?: boolean; hasHooks?: boolean;
}
```

Collectors, best source first:

| Agent | Inventory | Toggle / install |
|---|---|---|
| Claude | control protocol (`initialize`, `get_skills_dialog`, `get_hooks_listing`, `mcp_status`, `get_memory_dialog`, `reload_plugins`) in a short-lived headless process **without a prompt**; `claude plugin list --json --available`; `claude plugin marketplace list --json`; files: `installed_plugins.json`, `known_marketplaces.json`, settings files; `skillUsage` and `pluginUsage` from `~/.claude.json` | `claude plugin install\|uninstall\|enable\|disable\|update -s <scope> --json`; `claude plugin marketplace add\|remove\|update`; skills: write `skillOverrides` into the right settings file (JSON merge, keep the other keys); MCP: `claude mcp add-json\|remove -s <scope>`, `enabledMcpjsonServers` / `disabledMcpjsonServers` |
| Codex | app-server: `skills/list`, `plugin/list` (`marketplaceKinds:["local"]` for a quick list), `plugin/installed`, `plugin/read`, `hooks/list`, `mcpServerStatus/list {detail:"toolsAndAuthOnly"}`, `config/read {includeLayers:true}`; or `codex plugin list --json`, `codex mcp list --json` | `skills/config/write`, `plugin/install\|uninstall`, `marketplace/add\|remove\|upgrade`, `config/value/write` (`plugins."id".enabled`, `mcp_servers.<n>.enabled`), `config/batchWrite` (hook trust); `codex mcp add\|remove` |
| Devin | `devin skills list --json`; `devin rules list` (text); `devin mcp list` (text); config files `~/.config/devin/*.json`, `.devin/*` | `devin mcp add\|remove\|enable\|disable -s`; plugins need login (`devin plugins install\|remove\|update -y`) |
| OpenCode | `opencode debug agents`/`config` (JSON); `opencode api skill.list\|command.list\|plugin.list\|mcp.list` (verify against the running service); `opencode.json` | `opencode plugin add\|remove`, `opencode mcp add`, `experimental.mcp.*`, `experimental.config.update` |
| ACP agents (Devin, OpenCode, Gemini, Copilot, Goose…) | the `available_commands_update` session notification lists slash commands, skills included, per session | — |
| Everyone | filesystem scan of the known skill dirs (`SKILL.md` frontmatter only), rules files, `.mcp.json`-style configs | — |

Dedup and sharing: resolve `realpath` for every skill folder. When several agents report the same real path, show one card with per-agent badges (Claude ✓, Codex ✓, Devin ✓) instead of three cards.

## 8. Which operations are safe to offer

| Operation | Recommendation | How |
|---|---|---|
| **View / inspect** (list, details, SKILL.md preview, token cost, used-by, last used) | **Safe; ship first.** | Read-only collectors above. Never return `env`, `headers`, `http_headers`, `bearer_token`, `oauthAccount`, `auth.json` or credentials files; redact `get_settings.effective.env` and MCP `env`/`headers`. Don't run `claude mcp list/get` for polling (it spawns servers). |
| **Enable / disable** | **Safe, with clear scope and a "takes effect next session" note** | Claude plugin: `claude plugin enable\|disable -s user\|project\|local --json`. Claude skill: `skillOverrides` (plugin skills locked, so offer "disable plugin"). Codex skill: `skills/config/write`. Codex plugin / MCP: `config/value/write`. Devin MCP: `devin mcp enable\|disable -s`. Claude MCP project approval: `enabledMcpjsonServers` / `disabledMcpjsonServers`. Gemini: `gemini extensions enable\|disable --scope`. |
| **Install from a marketplace** | **Offer with confirmation.** Show the source repo/sha, components (skills/hooks/MCP/bin), and the warning that hooks and MCP run code. | Claude: `claude plugin install <p>@<mkt> -s <scope> --json`. **Never pass `-y`/`--accept-command` automatically**: a marketplace "command" source runs a command, so surface `shownCommand` to the user and only re-run with `--accept-command <sha256>` after explicit approval. Codex: `plugin/install` (watch `appsNeedingAuth`). Gemini: `extensions install --consent` only after the user agrees. Devin: requires login and syncs to the cloud manifest by default (offer `--local`). |
| **Add a marketplace** | Offer, with an allowlist of known ones; warn for arbitrary repos. | `claude plugin marketplace add owner/repo --scope`, `codex plugin marketplace add`. Respect Claude `strictKnownMarketplaces` / `blockedMarketplaces`. |
| **Update** | Safe | `claude plugin update` (restart needed), `claude plugin marketplace update`, `codex plugin marketplace upgrade`, `devin plugins update`. |
| **Remove / uninstall** | **Offer with a typed confirmation**; default to disable instead. | `claude plugin uninstall -s … --json` (offer `--keep-data`), `codex plugin remove --json` / `plugin/uninstall`, `devin plugins remove`, `claude\|codex\|devin mcp remove`. For user-authored skill folders: move to a trash dir (Claude uses `~/.claude/skills/.trash/`); never `rm -rf` a user's SKILL.md folder or a project file without asking. Never delete managed / synced / system / builtin items (read-only in the UI). |
| **Create a skill from a template** | **Safe and high value** | Write `<root>/<name>/SKILL.md` with spec-valid frontmatter (name = dir name, `[a-z0-9-]{1,64}`, description ≤1024), default root `.agents/skills` (project) or `~/.agents/skills` (user), and validate (`claude plugin validate <dir> --json` or `skills-ref validate`). Offer agent-specific optional fields in an "advanced" section (Claude `disable-model-invocation`, `allowed-tools`; Devin `triggers`; Codex `agents/openai.yaml`). For a Claude plugin skeleton, `claude plugin init <name> --with skills` exists. |
| **Share a skill to other agents** | **Safe if implemented as symlinks / copies the user can see** | Canonical `.agents/skills/<name>` plus a symlink `.claude/skills/<name> → ../../.agents/skills/<name>` (and the `~/` equivalents). That covers Claude, Codex, Devin, OpenCode, Gemini, Cursor, Copilot, Goose and Amp. Fall back to copying on Windows or when symlinks fail. Detect conflicts (same name already exists in the target) and existing sharing (same realpath). Alternatives: Codex `externalAgentConfig/import` (copies `.claude/skills` → `.agents/skills`, `.claude/agents` → `.codex/agents`); `claude import codex\|cursor\|gemini`; `npx skills add` (external tool, not recommended to invoke silently). |
| **Edit MCP server config** | Possible, but treat as sensitive. | Use the agent CLIs (`mcp add-json`, `codex mcp add`, `devin mcp add`) instead of hand-editing. Secrets should be referenced by env var names (`--bearer-token-env-var`, `${env:VAR}`), never stored in Overseer. |
| **Hooks** | View only at first; enable/trust is advanced. | Claude: `get_hooks_listing` (view); edits mean writing settings JSON. Codex: `hooks/list` shows `trustStatus`; trusting = `config/batchWrite hooks.state."<key>".trusted_hash` (same as the TUI). Hooks run arbitrary commands, so require explicit confirmation. |
| **Policy / managed / synced items** | **Read-only.** | Show a lock with the reason (Claude `locked_by`, Codex `isManaged` / `DISABLED_BY_ADMIN`, Devin governance-required plugins, Claude `strictKnownMarketplaces`). |

Restart / reload semantics to show in the UI:
- **Claude:** plugin install/update/enable needs a new session, or `/reload-plugins` / control `reload_plugins` in a live one. Skills live-reload in many cases; there is `reload_skills`.
- **Codex:** new threads pick up changes; `skills/changed` fires.
- **Devin:** changes apply on the next session.
- **Gemini:** extensions need a restart.

---

## 9. Caveats and open questions

- **Claude `system/init`** was not captured live: that would need a prompt and spend tokens. Its field list comes from the 2.1.285 binary. The `initialize` and other control responses were captured live.
- **Undocumented internal shapes:** the control-protocol subtypes `get_skills_dialog`, `get_hooks_listing` and `get_memory_dialog` are internal (used by IDE/desktop clients), so their shapes may change between releases. Feature-detect them and fall back to files and CLI.
- **Claude version differences:**
  - `--json` on `plugin marketplace add|remove|update` is listed in Appendix A (docs), but it is not in the 2.1.285 `--help`; only `marketplace list` has `--json`.
  - Appendix A also lists `install --marketplace <source>`, which is not in this build either.
- **Codex:**
  - The plugin RPCs are marked under development.
  - `codex mcp list --json` exposes `env_vars` names but not values; `config/read` does return raw config, so filter it.
  - Custom prompts (`~/.codex/prompts`) appear to be gone in 0.161.
  - The project `.codex/` layer is ignored until the project is trusted.
- **Devin:** `plugins` commands require login and default to a cloud-synced personal manifest; `skills/rules/mcp` have no JSON except `skills list --json`.
- **OpenCode 2.0:** `skill.list` / `command.list` returned empty in `--standalone` mode during this test. Needs re-checking against the background service. OpenCode 1.x (`opencode.json` `agent`, `command`, `mcp`, `plugin` keys; `.opencode/{agent,command,plugin}`) differs from 2.0.
- **Scratch dir incident:** during this research, the research scratch directory was wiped once by another process at about 14:15. Everything was recreated. The large intermediate files (schemas, string dumps, raw RPC output) were deleted at the end.
- **Possible model use:** `claude import <agent> --dry-run` printed a formatted summary. It is unclear whether that step calls a model, so treat it as possibly not free.


---

# Appendix A — Standards, Claude plugin format, marketplaces and registries (web research)

## Skills, plugins and marketplaces: standards and registries (research as of 2026-10-20)

Read-only web research. Everything below comes from official docs, official GitHub repos, or live API responses fetched on 2026-10-20. Where a doc was silent, that is stated. "Local evidence" means file shapes seen read-only in `~/.claude/plugins/` on this Mac.

---

### 0. TL;DR for building a skills/plugins UI

- **Skill format is converged:** `<dir>/<name>/SKILL.md` with YAML frontmatter `name` + `description` (Agent Skills spec). Every major agent reads it.
- **Shared skill path:** `.agents/skills/` (project) and `~/.agents/skills/` (user) are read by Codex, Gemini CLI, Cursor, OpenCode, GitHub Copilot CLI/VS Code, Amp, Cline, Warp, Zed, Pi and others. **Claude Code does NOT document `.agents/skills`.** It reads only `.claude/skills` / `~/.claude/skills`, but it officially supports a skill folder being a **symlink**. So the portable recipe is: canonical copy in `.agents/skills/<name>`, plus a symlink `.claude/skills/<name> -> ../../.agents/skills/<name>`. `npx skills` does exactly this.
- **Plugin formats:** there are now 3 families:
  1. **Claude Code plugins**: `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`. This is the de facto marketplace format. Copilot CLI, Codex (legacy-compatible) and the `npx skills` CLI all read `.claude-plugin/marketplace.json`.
  2. **Agent Plugins 1.0.0** (agent-plugins.org, launched 2026-08-06 by Vercel; maintainers from Amazon, Cursor, Microsoft, OpenAI and Vercel): root `plugin.json` + `skills/` + `mcp.json`. It defines **no marketplace format**. Supported by ChatGPT/Codex, Cursor, Copilot, Kiro and VS Code. Claude Code is not listed.
  3. **Vendor variants**: Codex `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`; Cursor `.cursor-plugin/plugin.json` + `.cursor-plugin/marketplace.json`; Copilot `.github/plugin/marketplace.json`; Gemini `gemini-extension.json`.
- **Machine-readable indexes a UI can browse (verified live):**
  - Claude official marketplace JSON: 315 plugins.
  - `anthropics/skills` marketplace: 5 plugin bundles.
  - skills.sh search API (`/api/search?q=`).
  - Gemini gallery `https://geminicli.com/extensions.json`: 2,198 entries.
  - Official MCP Registry `/v0.1/servers`.
  - Smithery `registry.smithery.ai/servers`.
  - OpenAI `openai/plugins` `.agents/plugins/marketplace.json` (`openai-curated`, 65 plugins).
  - Copilot `github/awesome-copilot` (182) and `github/copilot-plugins` (18).
- **Best programmatic control surfaces:**
  - **Claude:** the `claude plugin … --json` CLI, including `list --json --available` with `installCount`.
  - **Codex:** app-server JSON-RPC (`skills/list`, `skills/config/write`, `plugin/list|read|install|uninstall`, `marketplace/add|remove|upgrade`, `hooks/list`, `mcpServerStatus/list`, `config/*`), plus `codex plugin … --json`.

---

### 1. Agent Skills open standard (agentskills.io)

Sources: https://agentskills.io/specification, https://agentskills.io/home, https://agentskills.io/client-implementation/adding-skills-support, https://agentskills.io/llms.txt

#### 1.1 Directory structure
```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation (REFERENCE.md, FORMS.md, domain files)
├── assets/           # Optional: templates, images, data files
└── ...               # any other files
```
- Progressive disclosure has three levels:
  1. Metadata (~100 tokens; `name` and `description`) loads at startup.
  2. The body (under 5,000 tokens recommended; keep `SKILL.md` under 500 lines) loads on activation.
  3. Resources load on demand.
- File references are relative to the skill root, and should go only one level deep.

#### 1.2 SKILL.md frontmatter (spec)
| Field | Required | Constraints |
|---|---|---|
| `name` | yes | 1–64 chars; only `a-z`, `0-9`, `-`; no leading/trailing `-`; no `--`; **must match parent directory name** |
| `description` | yes | 1–1024 chars, non-empty; what it does + when to use |
| `license` | no | license name or bundled file ref (e.g. `Proprietary. LICENSE.txt has complete terms`) |
| `compatibility` | no | 1–500 chars; env requirements (product, packages, network) |
| `metadata` | no | map string→string (e.g. `author`, `version`) |
| `allowed-tools` | no | **space-separated string**, experimental, e.g. `Bash(git:*) Bash(jq:*) Read` |

```markdown
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
metadata:
  author: example-org
  version: "1.0"
---
```

#### 1.3 Validation
- Reference library is `skills-ref`: https://github.com/agentskills/agentskills/tree/main/skills-ref
- Command: `skills-ref validate ./my-skill` checks frontmatter validity and naming.
- Claude Code alternative: `claude plugin validate .claude/skills` validates SKILL.md frontmatter (v2.1.233+).

#### 1.4 Client implementation guidance (discovery)
Recommended scan table from the "adding skills support" page:

| Scope | Path | Purpose |
|---|---|---|
| Project | `<project>/.<your-client>/skills/` | native |
| Project | `<project>/.agents/skills/` | **cross-client interoperability** |
| User | `~/.<your-client>/skills/` | native |
| User | `~/.agents/skills/` | **cross-client interoperability** |

- The guide notes that some implementations also scan `.claude/skills/` (project and user), ancestor directories up to the git root, XDG config dirs, and user paths.
- **Collisions:** project overrides user. Within one scope, first-found or last-found is acceptable but must be consistent. Log a warning.
- **Trust:** gate project-level skills on folder trust.
- **Lenient parsing:**
  - Warn but still load on a name/dir mismatch or a name over 64 chars.
  - Skip the skill if `description` is missing or the YAML is unparseable.
  - Retry YAML that has unquoted colons.
- **Scan bounds:** skip `.git`/`node_modules`; max depth 4–6; max about 2,000 dirs.
- **Catalog:** `<available_skills><skill><name/><description/><location/></skill></available_skills>`.
- **Filtering:** hide disabled skills and those with `disable-model-invocation`.
- **Activation:** model-driven, via file read or an `activate_skill` tool. User-explicit activation via `/name` or `$name`.
- **Compaction:** protect skill content from compaction and dedupe activations.
- **Symlinks:** the spec and this guide say nothing about symlinks. Per-client support is listed in §1.6.

#### 1.5 Adopting clients
These are listed on agentskills.io as of 2026-10-20, with each client's instructions URL:
- Junie
- ZeroClaw
- Gemini CLI (geminicli.com/docs/cli/skills)
- Autohand Code CLI
- OpenCode (opencode.ai/docs/skills)
- OpenHands
- Mux
- Cursor (cursor.com/docs/context/skills)
- Amp
- Letta
- Firebender
- Goose
- GitHub Copilot (docs.github.com/.../about-agent-skills)
- VS Code (code.visualstudio.com/docs/copilot/customization/agent-skills)
- Claude Code (code.claude.com/docs/en/skills)
- Claude (platform.claude.com/.../agent-skills/overview)
- ChatGPT & Codex (developers.openai.com/codex/skills, which now redirects to learn.chatgpt.com/docs/build-skills)
- Piebald
- Factory
- pi
- Databricks Genie Code
- Agentman
- TRAE
- Spring AI
- Roo Code
- Mistral Vibe
- Command Code
- Ona
- VT Code
- Qodo
- Laravel Boost
- Emdash
- Snowflake Cortex Code
- Kiro
- Workshop
- Google AI Edge Gallery
- nanobot
- fast-agent
- bub
- Tabnine
- Vita
- Superconductor
- Deep Code
- Pulumi Neo
- Hermes Agent
- OpenClaw

#### 1.6 Which directories each major agent reads (verified from each vendor's docs)
| Agent | Project paths | User paths | Reads shared `.agents/skills`? | Symlinks |
|---|---|---|---|---|
| **Claude Code** | `.claude/skills/<n>/SKILL.md`; nested `<subdir>/.claude/skills`; parent dirs up to repo root; `--add-dir` dirs | `~/.claude/skills/`; enterprise `<managed-settings-dir>/.claude/skills/`; plugin `<plugin>/skills/` | **No (not documented)** | **Yes**: "A `<skill-name>` folder … can be a symlink"; loads once even if several locations point to the same target |
| **Codex** | `$CWD/.agents/skills`, each dir up to `$REPO_ROOT/.agents/skills` | `$HOME/.agents/skills`; admin `/etc/codex/skills`; system (bundled) | **Yes (native)** | **Yes**: "supports symlinked skill folders and follows the symlink target" |
| **Gemini CLI** | `.gemini/skills/` or alias `.agents/skills/` (`.agents` wins within tier) | `~/.gemini/skills/` or `~/.agents/skills/`; extension skills; built-in | Yes | not documented (but `/skills link <path>` exists) |
| **Cursor** | `.agents/skills/`, `.cursor/skills/`, plus nested ones anywhere in repo; compat `.claude/skills/`, `.codex/skills/` | `~/.agents/skills/`, `~/.cursor/skills/`; compat `~/.claude/skills/`, `~/.codex/skills/` | Yes | not documented |
| **OpenCode** | walks up to git worktree: `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | Yes | not documented |
| **GitHub Copilot CLI** | first-found-wins: `.github/skills/`, `.agents/skills/`, `.claude/skills/`, then parent dirs' same three | `~/.copilot/skills/`, `~/.agents/skills/`, plugin `skills/`, `COPILOT_SKILLS_DIRS` | Yes | not documented |
| **VS Code (Copilot)** | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | Yes | not documented. `chat.agentSkillsLocations` is deprecated |

- **Per-client frontmatter extensions:**
  - **Cursor:** `paths` (legacy `globs`), `disable-model-invocation`, `icon`, `color`, `metadata`.
  - **VS Code:** `argument-hint`, `user-invocable`, `disable-model-invocation`, and `context: fork` (experimental).
  - **OpenCode:** uses `metadata` keys `opencode/slash: "true"` and `opencode/autoinvoke: "false"`. Its permission config is `opencode.json` → `permission.skill` with patterns mapped to `allow|deny|ask`.
  - **Codex:** optional sidecar `agents/openai.yaml` (see §5.1).
- **Gemini CLI commands:**
  - `gemini skills list [--all]`
  - `gemini skills install <git-url|dir> [--scope user|workspace] [--path <subdir>] [--consent]`
  - `gemini skills uninstall <name> [--scope …]`
  - Slash: `/skills list|link|enable|disable|reload`

---

### 2. Claude Code SKILL.md extras

Source: https://code.claude.com/docs/en/skills. All fields are optional. Unknown fields are ignored.

| Field | Type / default | Purpose |
|---|---|---|
| `name` | string, default dir name | `/` command name |
| `description` | string | what + when; key use case first |
| `when_to_use` | string | appended to description; shares the 1,536-char cap |
| `argument-hint` | string | autocomplete hint, e.g. `[issue-number]` |
| `arguments` | string or list | named positional args for `$name` substitution |
| `disable-model-invocation` | bool, `false` | Claude won't auto-load; also blocks preloading into subagents |
| `user-invocable` | bool, `true` | `false` hides from `/` menu |
| `allowed-tools` | string or list | pre-approved tools for the invoking turn |
| `disallowed-tools` | string or list | removed while skill active |
| `model` | string or `inherit` | model override for the turn |
| `effort` | `low\|medium\|high\|xhigh\|max` | effort override |
| `context` | `fork` | run in a forked subagent |
| `agent` | string | subagent type with `context: fork` (e.g. `Explore`) |
| `background` | bool, `true` | with fork; `false` waits for result |
| `hooks` | object | hooks registered on invocation (last until session end) |
| `paths` | glob string or list | limit auto-loading to matching files |
| `shell` | `bash` (default) \| `powershell` | shell for `` !`cmd` `` injection |
| `metadata`, `license`, `compatibility` | per spec | accepted, not acted on |

- **Claude.ai and Skills API restriction:** only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are allowed there. Any other field is a hard error.
- **Substitutions:** `$ARGUMENTS`, `$ARGUMENTS[N]`/`$N`, `$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`.
- **Precedence:**
  - Enterprise > personal > project.
  - A user skill replaces a bundled skill or built-in command of the same name.
  - A skill beats a `.claude/commands/` file of the same name.
  - Plugin skills are namespaced `/plugin:skill`.
  - Nested skills load on demand and can be called as `/apps/web:deploy`.
- **Listing budget:**
  - The listing gets 1% of the context window (`skillListingBudgetFraction`, env `SLASH_COMMAND_TOOL_CHAR_BUDGET`).
  - Each entry is capped at 1,536 chars (`skillListingMaxDescChars`).
- **Settings to disable or adjust skills:**
  - `skillOverrides`: `{"deploy": "off"}`, with values `on | name-only | user-invocable-only | off`. The `/skills` menu writes it to `.claude/settings.local.json`.
  - `disableBundledSkills: true`
  - `disableSkillShellExecution: true`
- **Skill folders that are plugins:** a folder under `~/.claude/skills/` or `.claude/skills/` that has `.claude-plugin/plugin.json` loads as `<name>@skills-dir`.
- **claude.ai sync:** synced skills land in `~/.claude/skills/synced`. Trash is `~/.claude/skills/.trash/`.

---

### 3. Claude Code plugin system

Sources:
- https://code.claude.com/docs/en/plugins/manifest-reference (formerly plugins-reference)
- https://code.claude.com/docs/en/plugins/marketplace-reference
- https://code.claude.com/docs/en/plugins/create-marketplace
- https://code.claude.com/docs/en/plugins/cli-reference
- https://code.claude.com/docs/en/plugins/loading

#### 3.1 plugin.json (`.claude-plugin/plugin.json`, optional)
`name` is the only required key. Unknown top-level keys are stripped with a warning. `userConfig`, `channels`, `lspServers` and `monitors` entries are strict objects.

| Field | Notes |
|---|---|
| `$schema` | ignored at load |
| `name` | kebab-case; no spaces, `@`, `:`, `/`. Reserved: names starting `claude-`/`anthropic-`/`anthropics-`/`cc-plugin-`; `claude`, `claude-code`, etc. |
| `displayName`, `version`, `description`, `author{name,email,url}`, `homepage` (must parse as URL), `repository`, `license`, `keywords[]` | metadata. Setting `version` pins users until it changes |
| `metadata` | free-form; ignored (v2.1.222+) |
| `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl` | for Anthropic's directory listing only |
| `defaultEnabled` | default `true` |
| `dependencies` | `"name"`, `"name@marketplace"`, or `{name, marketplace, version}` |
| `settings` | only `agent`, `subagentStatusLine` take effect |
| `userConfig` | `{key: {type: string\|number\|boolean\|directory\|file, title, description, required?, default?, options?, multiple?, sensitive?, min?, max?}}` |
| `channels` | `[{server, displayName?, userConfig?}]` |
| `types` | `.d.ts` for mods |
| `skills` | path(s); **adds to** default `skills/` |
| `commands` | path(s) or map `{name: {source\|content, description, argumentHint, model, allowedTools}}`; **replaces** `commands/` |
| `agents` | `.md` paths; replaces `agents/` |
| `hooks` | path, inline object, or array; **merges** with `hooks/hooks.json` |
| `mcpServers` | path, `.mcpb`/`.dxt` bundle path or https URL, inline map, or array; merges with `.mcp.json` |
| `lspServers` | path, inline, or array; merges with `.lsp.json`. Fields: `command`, `extensionToLanguage` (required); `args`, `transport`, `env`, `initializationOptions`, `settings`, `workspaceFolder`, `startupTimeout`, `shutdownTimeout`, `requestTimeout`, `restartOnCrash`, `maxRestarts`, `diagnostics` |
| `outputStyles`, `workflows` | replace defaults |
| `experimental.themes`, `experimental.monitors`, `experimental.evals` | themes/monitors/evals (top-level `monitors`/`themes` still load, with a warning) |

- Every path must start with `./` and stay inside the plugin root. Exceptions: `skills` also accepts `"."`, and `mcpServers` accepts an https bundle URL.
- **Monitor entry:** `{name, command, description, when?: "always" | "on-skill-invoke:<skill>"}`.

**Standard layout:**
```
plugin/
├── .claude-plugin/plugin.json   # optional manifest
├── skills/<name>/SKILL.md       # (root SKILL.md alone => single-skill plugin)
├── commands/*.md                # legacy; prefer skills/
├── agents/*.md
├── hooks/hooks.json             # {"hooks": {...event map...}}
├── monitors/monitors.json
├── output-styles/*.md
├── themes/*.json
├── workflows/*.js
├── bin/                         # added to Bash PATH while enabled (claude.ai/Cowork refuse plugins with bin/)
├── settings.json                # agent / subagentStatusLine defaults
├── .mcp.json
└── .lsp.json
```

**Environment variables:**
- `${CLAUDE_PLUGIN_ROOT}`: the installed version dir; changes on update.
- `${CLAUDE_PLUGIN_DATA}`: `~/.claude/plugins/data/<id>/`; persists across updates and is deleted on last uninstall unless `--keep-data`.
- `${CLAUDE_PROJECT_DIR}`
- `${user_config.KEY}` and `CLAUDE_PLUGIN_OPTION_<KEY>`
- A plugin-root `CLAUDE.md` is NOT loaded.

#### 3.2 marketplace.json (`.claude-plugin/marketplace.json`)
- **Required:** `name`, `owner{name, email?, url?}`, `plugins[]`.
- **Optional:** `$schema` (official uses `https://anthropic.com/claude-code/marketplace.schema.json`), `description`, `version`, `metadata.{description,version,pluginRoot}`, `forceRemoveDeletedPlugins`, `allowCrossMarketplaceDependenciesOn[]`, `renames{old: new|null}`.
- **Name rule:** `[A-Za-z0-9][A-Za-z0-9._-]*`, no `..`. Many names are reserved:
  - Official names: `claude-plugins-official`, `anthropic-agent-skills`, `agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`, `first-party-plugins`, `claude-tag-plugins`, etc.
  - `inline`, `builtin`, `skills-dir`, `synced`, `npm`, `pip`, `github`, `gh`, …
  - Any name starting `claudeai-`.
  - Any name with non-ASCII characters.

**Plugin entry fields:**
- `name` and `source` are required.
- Optional: `description`, `version`, `category`, `tags[]`, `strict` (default true), `relevance{topic, signals}`, `dependencies`, `defaultEnabled`, `displayName`, `metadata`, `headers`, `headersHelper`.
- Entries also accept any plugin.json field (`author`, `homepage`, `commands`, `hooks` inline, `lspServers`, …) except the directory-listing fields.

**Plugin source types:**
```jsonc
"./plugins/formatter"                                       // relative (must start ./; bare name ok with metadata.pluginRoot)
{"source":"github","repo":"org/formatter","ref":"v2.0.0","sha":"<40-hex>"}
{"source":"url","url":"https://gitlab.example.com/g/formatter.git","ref":"main"}   // any git URL
{"source":"git-subdir","url":"org/monorepo","path":"tools/formatter","ref":"…","sha":"…"}  // sparse/partial clone
{"source":"npm","package":"@org/formatter","version":"^2.0.0","registry":"https://npm.example.com"}  // no install scripts
{"source":"archive","url":"https://…/formatter-2.0.0.zip","sha256":"<64-hex>"}   // v2.1.224+
{"source":"command","command":"my-tool claude-plugin-path","timeout":120,"mode":"copy|link"}  // v2.1.229+
```
- **Strict mode:**
  - `strict: true` (default): plugin.json is the authority, and the entry's components are appended to it.
  - `strict: false` with plugin.json present and the entry also declaring components: conflict error.
  - No plugin.json: the entry is the manifest.

**Marketplace sources** (used in settings and by `marketplace add`):
- `github{repo, ref, path, sparsePaths}`
- `git{url, ref, path, sparsePaths}`
- `url{url, headers, headersHelper}`: a direct link to marketplace.json. Relative plugin sources can't resolve with this type.
- `file{path}`, `directory{path}`
- `settings{name, plugins, owner}`: an inline catalog.
- Policy-only types: `hostPattern`, `pathPattern`, `skills-dir`, and `owner/*` repo wildcards.

#### 3.3 Settings keys
```json
{
  "enabledPlugins": { "formatter@my-marketplace": true, "x@synced": false },
  "extraKnownMarketplaces": {
    "your-marketplace": { "source": { "source": "git", "url": "https://git.example.com/org/mk.git", "ref": "main" }, "autoUpdate": true }
  },
  "strictKnownMarketplaces": [ { "source": "github", "repo": "your-org/*" },
                               { "source": "hostPattern", "hostPattern": "^git\\.example\\.com$" } ],
  "blockedMarketplaces": [ … ],
  "pluginConfigs": { … },            // non-sensitive userConfig values
  "syncClaudeAiPlugins": false,
  "disableCommandPluginSources": true
}
```
- **`enabledPlugins` precedence, low to high:**
  1. `--add-dir`
  2. user `~/.claude/settings.json`
  3. project `.claude/settings.json`
  4. local `.claude/settings.local.json`
  5. `--settings` flag
  6. managed
- **Plugin id suffixes:**
  - `@<marketplace>`
  - `@inline` (`--plugin-dir` / `--plugin-url` / `CLAUDE_CODE_PLUGIN_DIRS` / SDK)
  - `@skills-dir`
  - `@synced` (from claude.ai)

#### 3.4 On-disk layout (`~/.claude/plugins`, overridable with `CLAUDE_CODE_PLUGIN_CACHE_DIR`)
| Path | Content |
|---|---|
| `cache/<marketplace>/<plugin>/<version>/` | installed copy (`${CLAUDE_PLUGIN_ROOT}`). The old version gets an `.orphaned_at` marker and is removed 14 days later |
| `data/<plugin-id>/` | persistent data |
| `marketplaces/<name>/` | clone of git/url marketplaces (local file/dir marketplaces are not copied) |
| `synced/`, `.trash/` | claude.ai-synced plugins |
| `known_marketplaces.json` | `{name: {source, installLocation, lastUpdated, autoUpdate?}}` |
| `known_marketplaces_claudeai.json` | claude.ai-hosted marketplaces |
| `installed_plugins.json` | `{version: 2, plugins: {"<id>": [{scope, installPath, version, installedAt, lastUpdated, gitCommitSha, projectPath?}]}}` |
| `flagged-plugins.json` | delisted plugins |

Local evidence of the record shapes (paths elided):
```json
// installed_plugins.json
{"version":2,"plugins":{"vercel@claude-plugins-official":[{"scope":"user","installPath":"…/cache/claude-plugins-official/vercel/0.50.0","version":"0.50.0","installedAt":"2026-08-19T11:17:35.051Z","lastUpdated":"2026-09-22T18:49:25.698Z","gitCommitSha":"882e66c2…"}]}}
// known_marketplaces.json
{"claude-plugins-official":{"source":{"source":"github","repo":"anthropics/claude-plugins-official"},"installLocation":"…/marketplaces/claude-plugins-official","lastUpdated":"2026-10-20T10:45:41.214Z"}}
```
- **Undocumented internal caches** (seen locally; don't rely on them):
  - `plugin-catalog-cache.json`: `{version, fetchedAt, catalog:{generated_at, marketplace_sha, models, plugins:{"<id>":{plugin, tokens:{<model>:{always_on,on_invoke}}, components:{skills:[{name,chars}]…}}}}}`, with 315 entries.
  - `plugin-directory-cache-v2.json`: `{schemaVersion, fetchedAt, listings:[{id:"plugin_…", name, summary, surfaces:["claude_code","cowork","claude_ai"], source:{type:"directory", repository:{url,path,reviewed_commit}}, checks:{review:{state,by}}}], …}`, with 3,604 listings.

**Versions:**
- Resolution order: manifest `version`, then entry `version`, then a git SHA (12 chars), the archive sha256, or `unknown`.
- **Auto-update:** on by default for official Anthropic marketplaces, off for others. Controlled by `autoUpdate`; disabled by `DISABLE_AUTOUPDATER` and related env vars.

#### 3.5 `claude plugin` CLI (alias `claude plugins`)
Exit codes are 0 for success and 1 for failure. `validate` also uses 2 for an unexpected error. `--scope` takes `user | project | local`, and `update` also accepts `managed`.

| Command | Key flags |
|---|---|
| `plugin init` | `--description --author --author-email --with skills\|agents\|hooks\|mcp\|lsp\|output-style\|channel -f` |
| `plugin install <p[@mk]>` | `-s/--scope` (default user), `--config k=v`, `-y`, `--accept-command <sha256>`, `--json`, `--marketplace <source>` |
| `plugin uninstall <p>` | `-s`, `--keep-data`, `--prune`, `-y`, `--json` |
| `plugin enable <p>` / `disable <p>` | `-s` (auto-detect local→project→user), `--json`; `disable -a/--all` |
| `plugin update <p>` | `-s`, `-y`, `--accept-command`, `--json` |
| `plugin list` | `--json`, `--available` (needs `--json`), `--data-size [p]` |
| `plugin details <name>` | component inventory + token cost |
| `plugin configure <p@mk>` | `--values-stdin`, `--json` |
| `plugin prune` | `-s --dry-run -y` |
| `plugin validate <path>` | `--strict`, `--json` → `{success, strict, target, manifest, contents[{file, errors, warnings, notes}]}` |
| `plugin tag`, `plugin test`, `plugin eval`, `plugin eval init` | release/eval tooling |
| `plugin marketplace add <source>` | `--scope`, `--sparse <paths…>`, `--claudeai`, `--json` |
| `plugin marketplace list` | `--json` → `[{name, source, repo?, url?, path?, ref?, installLocation}]` |
| `plugin marketplace remove <name>` | `--scope`, `--json` |
| `plugin marketplace update [name]` | `--json` (requires name) |

- **`marketplace add` source strings:**
  - `owner/repo[#ref|@ref]` → github
  - `user@host:path[.git][#ref]` → git
  - https URLs ending `.git`, containing `/_git/`, or naming github.com/gitlab.com repos → git
  - other http(s) URLs → url (a raw marketplace.json)
  - a dir path → directory
  - a `.json` path → file
- **JSON results:**
  - `install`/`uninstall`/`update`/`enable`/`disable` `--json` print one object on the **last stdout line**, with `{command, outcome:"ok"|"failed", message, pluginId?, scope?, failureCode?, alreadyInGoalState?, keptData?, shownCommand?}`.
  - Marketplace commands print, for example:
```json
{"command":"marketplace-remove","outcome":"ok","marketplace":"your-marketplace","message":"Successfully removed marketplace: your-marketplace"}
```
- **`plugin list --json` items:** `{id, version, scope, enabled, installPath, readFromFolder?, folderVersion?, installedAt?, lastUpdated?, projectPath?, mcpServers?, errors?, notes?, errorDetails?, noteDetails?, hasUserConfig?, projectEnabled?, dataDirSize?}`.
- **`--json --available`** returns `{installed:[…], available:[{pluginId, name, marketplaceName, source, description?, version?, installCount?}]}`. This is a cheap way for a UI to get a browsable catalog with install counts.
- **In-session:** `/plugin` (tabs Discover / Installed / Marketplaces / Errors / Stats), `/plugin install|enable|disable|uninstall|configure|validate|marketplace …`, `/reload-plugins [--force]`.
- **Session-only loading:** `--plugin-dir <dir|zip>`, `--plugin-url <zip-url>`.

#### 3.6 Official Anthropic marketplaces (fetched live)
**`anthropics/claude-plugins-official`**
- URL: https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json
- Top-level keys: `$schema`, `name: "claude-plugins-official"`, `description`, `owner {name: "Anthropic", email: "support@anthropic.com"}`, `renames` (10 entries), `plugins`.
- **315 plugins.** Sources: `url` 164, `git-subdir` 98, relative 53 (`./plugins/*`, `./external_plugins/*`).
- Categories: development 123, productivity 69, database 39, monitoring 22, security 18, deployment 9, design 8, others small.
- Entry keys: `name`, `description`, `source` (always); `category` 301; `homepage` 299; `author` 233; `displayName`/`strict`/`version` 14; `lspServers` 12; `skills`/`tags` 3.
```json
{"name":"42crunch-api-security-testing","description":"Automate API security …","author":{"name":"42Crunch"},"category":"security",
 "source":{"source":"git-subdir","url":"https://github.com/42Crunch-AI/claude-plugins.git","path":"plugins/api-security-testing","ref":"v1.5.5","sha":"faf53053…"},
 "homepage":"https://42crunch.com"}
{"name":"clangd-lsp","version":"1.0.0","source":"./plugins/clangd-lsp","category":"development","strict":false,
 "lspServers":{"clangd":{"command":"clangd","args":["--background-index"],"extensionToLanguage":{".c":"c",".cpp":"cpp"}}}}
```

**`anthropics/skills`**
- URL: https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json
- `name: "anthropic-agent-skills"`, `owner`, `metadata {description, version: "1.0.0"}`.
- **5 plugins**, all `"source": "./"` with `strict: false` and explicit `skills` arrays:
  - `document-skills` (xlsx, docx, pptx, pdf)
  - `example-skills` (12 skills)
  - `claude-api`
  - `academy-guide`
  - `discernment-nudge`
```json
{"name":"document-skills","description":"…","source":"./","strict":false,"skills":["./skills/xlsx","./skills/docx","./skills/pptx","./skills/pdf"]}
```

**Web directory:**
- `claude.com/plugins` redirects to `https://claude.com/marketplace/plugins`. It is server-rendered with install counts. **No public JSON API was found** (`/plugins.json` and `/api/plugins` return 404).
- For machine-readable data, use the marketplace.json above plus `claude plugin list --json --available` (`installCount`).

---

### 4. Other registries with machine-readable indexes

#### 4.1 skills.sh / `npx skills` (vercel-labs/skills)
Repo: https://github.com/vercel-labs/skills. Docs are `docs/agents.md`, `docs/commands.md`. Requires Node 22.20+.

- **Install:** `npx skills add <source> [-g] [-a <agent…>] [-s <skill…>|'*'] [-l] [--copy] [-y] [--all]`
- **Source formats:**
  - `owner/repo`
  - a GitHub URL, or a `…/tree/main/skills/<name>` URL
  - GitLab, Azure Repos (`…/_git/repo?path=…&version=GB…`) or any git URL (ssh too)
  - a local path
  - a direct `SKILL.md` or archive URL (zip/tar/tgz; limits 10 MiB download, 25 MiB extracted, 1,000 files)
  - well-known discovery at `https://host/.well-known/agent-skills/index.json` (legacy `/.well-known/skills/index.json`), schema `https://schemas.agentskills.io/discovery/0.2.0/schema.json`
- **Other commands:**
  - `find [query] [--owner]`
  - `list`
  - `use <source>@<skill> [--agent]` (run without installing)
  - `check`, `update`, `remove`/`rm`, `init`
  - `experimental_sync` (links skills from npm deps; `package.json` `"skills": ["npm:pkg", "owner/repo@skill"]`; tracks `skills-lock.json`)
  - `experimental_install` (restore from `skills-lock.json`)
- **Install method:**
  - **Symlink (recommended):** a canonical copy plus symlinks into each agent dir.
  - **Copy:** `--copy`.
  - The canonical/universal dir is `.agents/skills`. Selecting Claude Code creates links under `.claude/skills/` pointing to the shared skills.
- **It reads Claude marketplaces too:** `src/plugin-manifest.ts` parses `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` to discover skills in a repo.
- **Global lock file:** `$XDG_STATE_HOME/skills/.skill-lock.json`, else `~/.agents/.skill-lock.json`. It has `version: 3` and is keyed by skill name, `{source, sourceType, sourceUrl, ref?, skillPath?, skillFolderHash, installedAt, updatedAt, pluginName?}`.
- **Search API** (live, no auth): `GET https://skills.sh/api/search?q=<query>&limit=<n>[&owner=<org>]`. It is overridable with `SKILLS_API_URL`. Skill page URL: `https://skills.sh/<id>`.
```json
{"query":"pdf","searchType":"fuzzy","skills":[{"id":"anthropics/skills/pdf","source":"anthropics/skills","skillId":"pdf","name":"pdf","installs":213476}, …],"count":3}
```
- **Per-agent install paths:** verbatim from `docs/agents.md`. Format is `--agent` id: project path | global path.
  - `aider-desk`: `.aider-desk/skills/` | `~/.aider-desk/skills/`
  - `amp`, `replit`, `universal`: `.agents/skills/` | `~/.config/agents/skills/`
  - `antigravity`: `.agents/skills/` | `~/.gemini/antigravity/skills/`
  - `antigravity-cli`: `.agents/skills/` | `~/.gemini/antigravity-cli/skills/`
  - `astrbot`: `data/skills/` | `~/.astrbot/data/skills/`
  - `autohand-code`: `.autohand/skills/` | `~/.autohand/skills/`
  - `augment`: `.augment/skills/` | `~/.augment/skills/`
  - `bob` (IBM Bob): `.bob/skills/` | `~/.bob/skills/`
  - **`claude-code`: `.claude/skills/` | `~/.claude/skills/`**
  - `openclaw`: `skills/` | `~/.openclaw/skills/`
  - **`cline`, `codex`, `dexto`, `fx`, `kimi-code-cli`, `loaf`, `pi`, `sarvam-code`, `warp`, `zed`: `.agents/skills/` | `~/.agents/skills/`**
  - `codearts-agent`: `.codeartsdoer/skills/` | `~/.codeartsdoer/skills/`
  - `codebuddy`: `.codebuddy/skills/` | `~/.codebuddy/skills/`
  - `codemaker`: `.codemaker/skills/` | `~/.codemaker/skills/`
  - `codestudio`: `.codestudio/skills/` | `~/.codestudio/skills/`
  - `command-code`: `.commandcode/skills/` | `~/.commandcode/skills/`
  - `continue`: `.continue/skills/` | `~/.continue/skills/`
  - `cortex`: `.cortex/skills/` | `~/.snowflake/cortex/skills/`
  - `crush`: `.crush/skills/` | `~/.config/crush/skills/`
  - **`cursor`: `.agents/skills/` | `~/.cursor/skills/`**
  - `deepagents`: `.agents/skills/` | `~/.deepagents/agent/skills/`
  - `devin`: `.devin/skills/` | `~/.config/devin/skills/`
  - `droid` (Factory): `.agents/skills/` | `~/.factory/skills/`
  - `eve`: `agent/skills/` | project-only
  - `firebender`: `.agents/skills/` | `~/.firebender/skills/`
  - `forgecode`: `.forge/skills/` | `~/.forge/skills/`
  - **`gemini-cli`: `.agents/skills/` | `~/.gemini/skills/`**
  - **`github-copilot`: `.agents/skills/` | `~/.copilot/skills/`**
  - `goose`: `.goose/skills/` | `~/.config/goose/skills/`
  - `grok`: `.grok/skills/` | `~/.grok/skills/`
  - `hermes-agent`: `.hermes/skills/` | `~/.hermes/skills/`
  - `inference-sh`: `.inferencesh/skills/` | `~/.inferencesh/skills/`
  - `jazz`: `.jazz/skills/` | `~/.jazz/skills/`
  - `junie`: `.junie/skills/` | `~/.junie/skills/`
  - `iflow-cli`: `.iflow/skills/` | `~/.iflow/skills/`
  - `kilo`: `.agents/skills/` | `~/.kilo/skills/`
  - `kimchi`: `.kimchi/skills/` | `~/.config/kimchi/harness/skills/`
  - `kiro-cli`: `.kiro/skills/` | `~/.kiro/skills/`
  - `kode`: `.kode/skills/` | `~/.kode/skills/`
  - `lingma`: `.lingma/skills/` | `~/.lingma/skills/`
  - `mcpjam`: `.mcpjam/skills/` | `~/.mcpjam/skills/`
  - `minimax-code`: `.minimax/skills/` | `~/.minimax/skills/`
  - `mistral-vibe`: `.vibe/skills/` | `~/.vibe/skills/`
  - `moxby`: `.moxby/skills/` | `~/.moxby/skills/`
  - `mux`: `.mux/skills/` | `~/.mux/skills/`
  - **`opencode`: `.agents/skills/` | `~/.config/opencode/skills/`**
  - `openhands`: `.openhands/skills/` | `~/.openhands/skills/`
  - `ona`: `.ona/skills/` | `~/.ona/skills/`
  - `posit-assistant`: `.posit/assistant/skills/` | `~/.posit/assistant/skills/`
  - `qoder`: `.qoder/skills/` | `~/.qoder/skills/`
  - `qoder-cn`: `.qoder/skills/` | `~/.qoder-cn/skills/`
  - `qwen-code`: `.qwen/skills/` | `~/.qwen/skills/`
  - `reasonix`: `.reasonix/skills/` | `~/.reasonix/skills/`
  - `rovodev`: `.rovodev/skills/` | `~/.rovodev/skills/`
  - `roo`: `.roo/skills/` | `~/.roo/skills/`
  - `tabnine-cli`: `.tabnine/agent/skills/` | `~/.tabnine/agent/skills/`
  - `terramind`: `.terramind/skills/` | `~/.terramind/skills/`
  - `tinycloud`: `.tinycloud/skills/` | `~/.tinycloud/skills/`
  - `trae`: `.trae/skills/` | `~/.trae/skills/`
  - `trae-cn`: `.trae/skills/` | `~/.trae-cn/skills/`
  - `windsurf`: `.windsurf/skills/` | `~/.codeium/windsurf/skills/`
  - `zcode`: `.zcode/skills/` | `~/.zcode/skills/`
  - `zencoder`, `zenflow`: `.zencoder/skills/` | `~/.zencoder/skills/`
  - `neovate`: `.neovate/skills/` | `~/.neovate/skills/`
  - `pochi`: `.pochi/skills/` | `~/.pochi/skills/`
  - `promptscript`: `.agents/skills/` | project-only
  - `adal`: `.adal/skills/` | `~/.adal/skills/`
- **Caveat on that table:** it shows where *the `skills` CLI writes*. Real agent read paths are sometimes wider; for example, Codex also reads parent dirs and `/etc/codex/skills`. Its global path for `amp`/`universal` is `~/.config/agents/skills/`, unlike Codex's `~/.agents/skills/`.
- **Feature compatibility** (from the same doc):
  - `context: fork` works only in Claude Code.
  - Hooks in skills work in Claude Code, Cline and Kiro CLI.
  - `allowed-tools` works almost everywhere except Kiro CLI and Zencoder.

#### 4.2 Gemini CLI extension gallery
- **Index (live, no auth):** `GET https://geminicli.com/extensions.json` returns a JSON array of **2,198** entries. Browse UI: https://geminicli.com/extensions/browse/
```json
{"id":"@obra/superpowers","rank":1,"url":"https://github.com/obra/superpowers","fullName":"obra/superpowers","repoDescription":"…","stars":299294,
 "lastUpdated":"2026-10-15T07:00:31Z","extensionName":"superpowers","extensionVersion":"7.0.0","extensionDescription":"…",
 "avatarUrl":"…","hasMCP":false,"hasContext":true,"isGoogleOwned":false,"licenseKey":"mit","hasHooks":true,"hasSkills":true,"hasCustomCommands":false}
```
- **Listing:** add the GitHub topic `gemini-cli-extension`. A daily crawler adds the repo if `gemini-extension.json` validates.
- **Commands:**
  - `gemini extensions install <github-url|path> [--ref] [--auto-update] [--pre-release] [--consent] [--skip-settings]`
  - `gemini extensions uninstall|enable|disable [--scope]|update [--all]|link <path>|new <path> [template]|config <name> [setting] [--scope]|list`
- **Manifest:** `gemini-extension.json` with `name`, `version`, `description`, `mcpServers` (`${extensionPath}`), `contextFileName`, `excludeTools`, `migratedTo`, `plan.directory`, `settings[{name, description, envVar, sensitive}]`, `themes`. Hooks, skills, commands and sub-agents live in directories.
- Extensions are installed to `~/.gemini/extensions/<name>`.
- Sources: https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md and docs/extensions/releasing.md

#### 4.3 Official MCP Registry
- **Base:** `https://registry.modelcontextprotocol.io`. `/v0.1/servers` and `/v0/servers` both respond. Docs at `/docs`.
- **Endpoints:**
  - List: `GET /v0.1/servers?limit=&cursor=&search=&version=latest`
  - One server: `GET /v0.1/servers/{urlencoded name}/versions/latest`
- **Response:**
```json
{"servers":[{"server":{"$schema":"https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json","name":"io.github.github/github-mcp-server",
  "title":"GitHub","version":"2.0.2","repository":{"url":"https://github.com/github/github-mcp-server","source":"github"},
  "packages":[{"registryType":"oci","identifier":"ghcr.io/github/github-mcp-server:2.0.2","transport":{"type":"stdio"},"runtimeArguments":[…]}],
  "remotes":[{"type":"streamable-http","url":"https://api.githubcopilot.com/mcp/","headers":[{"name":"Authorization","isSecret":true}]}]},
  "_meta":{"io.modelcontextprotocol.registry/official":{"status":"active","publishedAt":"…","updatedAt":"…","isLatest":true}}}],
 "metadata":{"nextCursor":"…","count":1}}
```
- `packages[].registryType` takes `npm | pypi | oci | nuget | mcpb`. Install by translating into the agent's MCP config, for example `claude mcp add`, `codex mcp add`, or `.mcp.json`.

#### 4.4 Smithery
- `GET https://registry.smithery.ai/servers?q=<query>&pageSize=<n>` works anonymously.
- Response: `{servers:[{id, qualifiedName, namespace, displayName, description, iconUrl, verified, useCount, remote, isDeployed, homepage, …}], pagination:{currentPage, pageSize, totalPages, totalCount}}`.
- Smithery servers are also mirrored into the official registry under `ai.smithery/*`, with remotes that need a `Bearer {smithery_api_key}`.

#### 4.5 GitHub Copilot CLI plugins
Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference

- **Commands:**
  - `copilot plugin install|add <spec>`, `uninstall|remove|rm`, `list [--json]` (`[{name, marketplace?, version?, enabled, source, installedFrom?}]`), `update <name>|--all`, `enable`/`disable`
  - `copilot plugin marketplace add <owner/repo[#ref]|url|path>`, `list [--json]`, `browse <name> [--json]`, `update|refresh [name]`, `remove <name> [--force]`
- **Install specs:** `plugin@marketplace`, `OWNER/REPO`, `OWNER/REPO:PATH`, a git URL, or a local path.
- **Manifest lookup:**
  - Agent Plugins root `plugin.json` wins, with `$schema` 1.0.0 or **1.1.0**.
  - Legacy fallback, checked in order: `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/plugin.json`.
- **Marketplace lookup:** `marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json`. The format is Claude-compatible: `name`, `owner`, `plugins`, `metadata.pluginRoot`, and github/url sources with `sha`.
- **On disk:**
  - `~/.copilot/installed-plugins/<MARKETPLACE>/<PLUGIN>`
  - `_direct/<SOURCE-ID>/` for direct installs
  - marketplace cache `~/Library/Caches/copilot/marketplaces/` (`COPILOT_CACHE_HOME`)
- **Settings:** `enabledPlugins`, `extraKnownMarketplaces` (with `autoUpdate`), `COPILOT_HOME`.
- **Default marketplaces:**
  - Built-in **`awesome-copilot`** (`github/awesome-copilot` → `.github/plugin/marketplace.json`, **182 plugins**, relative sources like `"plugins/accessibility-kanban"`).
  - Optional `github/copilot-plugins` (**18 plugins**).

#### 4.6 Cursor
Source: https://cursor.com/docs/reference/plugins

- **Plugin formats:**
  - Agent Plugins (root `plugin.json`: skills + MCP).
  - Cursor Plugins (`.cursor-plugin/plugin.json`: rules, skills, agents, commands, hooks, `mcp.json`, variables, `logo`).
- **Marketplace file:** `.cursor-plugin/marketplace.json`.
  - Fields: `name`, `owner`, `plugins` (≤10 MB), `metadata{description, version, pluginRoot}`.
  - Entry `source` can be a bare dir name; the entry is merged with the plugin's manifest, and the manifest wins.
- **Distribution:**
  - Official Cursor Marketplace (cursor.com/marketplace; submit at /marketplace/publish).
  - Community index at cursor.directory.
  - Team marketplaces imported from GitHub (Dashboard → Settings → Plugins → Import).
  - **No public JSON index API was found.**

#### 4.7 OpenAI / Codex catalogs
- **`openai/skills` is DEPRECATED** (README banner). It points to `openai/plugins` and the "Build plugins" guide. It still holds 44 SKILL.md files: `skills/.curated/*` (39) and `skills/.system/*` (5: imagegen, openai-docs, plugin-creator, skill-creator, skill-installer). Install with `$skill-installer <name>` or `$skill-installer install https://github.com/openai/skills/tree/main/skills/.experimental/<x>`.
- **`openai/plugins`:**
  - Marketplace file: `https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json`
  - `{name:"openai-curated", interface:{displayName:"Codex official"}, plugins:[…]}`, **65 plugins**, all `{"source":"local","path":"./plugins/<x>"}`.
```json
{"name":"linear","source":{"source":"local","path":"./plugins/linear"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Productivity"}
```
  - Plugin manifests live at `plugins/<x>/.codex-plugin/plugin.json`, e.g. `{name, version, description, author, homepage, repository, license, keywords, apps:"./.app.json", mcpServers:"./.mcp.json", interface:{displayName, shortDescription, longDescription, developerName, category, capabilities, websiteURL, privacyPolicyURL, termsOfServiceURL, supportURL, defaultPrompt[], brandColor, brandColorDark, composerIcon, logo, screenshots[]}}`.

#### 4.8 Agent Plugins 1.0.0 (cross-vendor package format; no registry)
Sources: https://agent-plugins.org/specification, https://vercel.com/changelog/introducing-agent-plugins-1-0-0

- **Layout:** root `plugin.json` (required); `skills/<name>/SKILL.md` (only immediate children); optional `mcp.json`; optional vendor dirs named by reverse-DNS namespace (e.g. `com.github.copilot/`).
- **`plugin.json`:**
  - The schema is closed. Allowed keys: `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`.
  - `$schema` and `name` are required.
  - `name` is 1–64 chars from `[a-z0-9.-]`, alphanumeric at both ends, with no `--` or `..`.
  - **No inline component paths.**
```json
{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"minimal-plugin"}
```
- **`mcp.json`:**
  - `{"$schema":"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json","mcpServers":{name:{type:"stdio",command,args,env,cwd} | {type:"streamable-http"|"sse",url,headers}}}`
  - Placeholders `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`.
- Supported by ChatGPT/Codex, Cursor, GitHub Copilot, Kiro and VS Code. **Claude Code is not listed**, but it does export `CLAUDE_PLUGIN_*`, and Codex/Copilot also export `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` for compatibility.

---

### 5. Codex (OpenAI)

The developers.openai.com/codex/* docs now 308-redirect to learn.chatgpt.com/docs/*.

#### 5.1 Skills
Source: https://learn.chatgpt.com/docs/build-skills

- **Locations:**

  | Scope | Path |
  |---|---|
  | REPO | `$CWD/.agents/skills` |
  | REPO | `$CWD/../.agents/skills` (each dir up to root) |
  | REPO | `$REPO_ROOT/.agents/skills` |
  | USER | `$HOME/.agents/skills` |
  | ADMIN | `/etc/codex/skills` |
  | SYSTEM | bundled |

  - Duplicate names are not merged; both appear.
  - `$CODEX_HOME/skills` (older docs) is **not** mentioned in current docs.
- **SKILL.md:** requires `name` and `description`.
- **Optional sidecar `agents/openai.yaml`:**
```yaml
interface: {display_name, short_description, icon_small: "./assets/small-logo.svg", icon_large, brand_color: "#3B82F6", default_prompt}
policy: {allow_implicit_invocation: false}   # default true
dependencies: {tools: [{type: "mcp", value: "openaiDeveloperDocs", description, transport: "streamable_http", url: "https://developers.openai.com/mcp"}]}
```
- **Disable a skill** in `~/.codex/config.toml`, then restart:
```toml
[[skills.config]]
path = "/path/to/skill/SKILL.md"   # config-reference example uses the folder path
enabled = false
```
- Also `skills.max_context_tokens` (default 2% of context, max 10,000) and `features.skill_mcp_dependency_install`.
- **Invocation:** `/skills` or `$name` in CLI/IDE; `@` in ChatGPT; implicit via description.
- **Symlinks:** followed.
- **Install:** `$skill-installer <name>`.

#### 5.2 Plugins and marketplaces
Sources: https://learn.chatgpt.com/docs/plugins, https://developers.openai.com/codex/plugins/build

- **Manifest:**
  - Portable: root `plugin.json` (Agent Plugins) with `extensions."com.openai"{apps, hooks, onboardingSkill, interface{…}}`.
  - Legacy: `.codex-plugin/plugin.json`, used when `extensions.com.openai` is absent. Fields include `skills: "./skills/"`, `mcpServers: "./.mcp.json"`, `apps: "./.app.json"`, `hooks`, `interface`.
  - Default plugin hooks file is `hooks/hooks.json`.
  - Plugin commands get `PLUGIN_ROOT`/`PLUGIN_DATA` plus `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`.
- **Marketplace files Codex reads:**
  - `$REPO_ROOT/.agents/plugins/marketplace.json`
  - `$REPO_ROOT/.claude-plugin/marketplace.json` (legacy-compatible)
  - `~/.agents/plugins/marketplace.json`
  - Format: `{name, interface:{displayName}, plugins:[{name, source:{source:"local", path:"./plugins/x"} | "./path" | url | git-subdir{ref|sha} | npm{package, version, registry}, policy:{installation: AVAILABLE|INSTALLED_BY_DEFAULT|NOT_AVAILABLE, authentication: ON_INSTALL|ON_USE}, category}]}`
- **Cache:** `~/.codex/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION/`, where `$VERSION` is `local` for local plugins.
- **Config:**
```toml
[plugins."my-plugin@local-repo"]
enabled = true
[plugins."docs-helper@my-marketplace".mcp_servers.search]
enabled = true
enabled_tools = ["search_docs"]           # also disabled_tools, default_tools_approval_mode = auto|prompt|writes|approve, tools.<t>.approval_mode
[marketplaces.my-marketplace]
source_type = "git"                        # or "local" (absolute path)
source = "https://github.com/example/plugins.git"
ref = "main"
sparse_paths = [".agents", "plugins/docs-helper"]
```
  - Also `features.remote_plugin` (remote catalog, default on) and `features.apps`.
- **CLI** (from `codex-rs/cli/src/plugin_cmd.rs`, `marketplace_cmd.rs`):
  - `codex plugin add <PLUGIN[@MARKETPLACE]> [-m MARKETPLACE] [--json]`
  - `codex plugin list [-m MARKETPLACE] [--json] [--available]`
  - `codex plugin remove <PLUGIN[@MARKETPLACE]> [-m] [--json]`
  - `codex plugin marketplace add <SOURCE: local path | owner/repo[@ref] | https git | ssh git> [--ref REF] [--sparse PATH…] [--json]`
  - `codex plugin marketplace list [--json]`
  - `codex plugin marketplace upgrade [NAME] [--json]`
  - `codex plugin marketplace remove <NAME> [--json]`
  - TUI: `/plugins` (Space toggles enabled).
  - The official curated marketplace is `openai-curated`, from the `openai/plugins` repo, plus a remote ChatGPT plugin catalog.

#### 5.3 MCP
- **CLI:**
  - `codex mcp list [--json]`
  - `codex mcp get <name> [--json]`
  - `codex mcp add <NAME> (--url <URL> [--bearer-token-env-var V] [--oauth-client-id …] [--oauth-resource …] | [--env K=V] -- <COMMAND>…)`
  - `codex mcp remove <name>`
  - `codex mcp login <name> [--scopes a,b]`
  - `codex mcp logout <name>`
- **Config:** `[mcp_servers.<name>]` with keys `command`, `args`, `cwd`, `env`, `env_vars`, `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, `http_headers_helper`, `enabled`, `enabled_tools`, `disabled_tools`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `required`, `auth = oauth|chatgpt`.

#### 5.4 Hooks
Source: https://learn.chatgpt.com/docs/hooks

- **Files:** `~/.codex/hooks.json`, `~/.codex/config.toml` `[hooks]`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`. All layers run. Project hooks need a trusted `.codex/`.
- **Events:** `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `Interrupt`, `SessionStart`, `SubagentStart`, `SessionEnd`.
- **Handlers:** `command` and `mcp_tool` run; `prompt` and `agent` are parsed but skipped. The format is Claude-like: `{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"…","statusMessage":"…"}]}]}}`.
- **Trust:** hooks are trusted by hash. Use `/hooks` to review. Bypass with `--dangerously-bypass-hook-trust`.
- **Disable:** `[features] hooks = false` (`codex_hooks` is a deprecated alias). Admins can set `allow_managed_hooks_only` in `requirements.toml`.

#### 5.5 AGENTS.md and custom prompts
- **AGENTS.md:**
  - Global: `$CODEX_HOME` (default `~/.codex`) `AGENTS.override.md`, else `AGENTS.md`.
  - Project: walk from the git root down to cwd. Per dir, read `AGENTS.override.md` → `AGENTS.md` → `project_doc_fallback_filenames`, at most one file per dir.
  - Files are concatenated root→cwd.
  - `project_doc_max_bytes` defaults to 32 KiB.
- **Custom prompts are deprecated** ("Use skills"). They live in `~/.codex/prompts/*.md` (top level only) with frontmatter `description` and `argument-hint`, are invoked as `/prompts:<name>`, and support `$1..$9`, `$ARGUMENTS`, `$NAMED` and `$$`.

#### 5.6 app-server JSON-RPC (skills / plugins / MCP / config)
- **Sources:** https://learn.chatgpt.com/docs/app-server, plus the authoritative types in `openai/codex` `codex-rs/app-server-protocol/src/protocol/common.rs` and `v2/plugin.rs`. All fields are camelCase on the wire.

| Method | Params → Result |
|---|---|
| `skills/list` | `{cwds: string[], forceReload: bool}` → `{data: [{cwd, skills: SkillMetadata[], errors: [{path, message}]}]}` |
| `skills/extraRoots/set` | `{extraRoots: abs[]}` → `{}` (process-level, not persisted) |
| `skills/config/write` | `{path?: abs, name?: string, enabled: bool}` → `{effectiveEnabled: bool}` |
| `skills/changed` (notification) | watched skill files changed |
| `hooks/list` | `{cwds}` → `{data: [{cwd, hooks: HookMetadata[], warnings, errors}]}` |
| `marketplace/add` | `{source, refName?, sparsePaths?}` → `{marketplaceName, installedRoot, alreadyAdded}` |
| `marketplace/remove` | `{marketplaceName}` → `{marketplaceName, installedRoot?}` |
| `marketplace/upgrade` | `{marketplaceName?}` → `{selectedMarketplaces, upgradedRoots, errors[{marketplaceName, message}]}` |
| `plugin/list` | `{cwds?, marketplaceKinds?: (local\|vertical\|workspaceDirectory\|sharedWithMe\|createdByMeRemote)[], forceRefetch}` → `{marketplaces: PluginMarketplaceEntry[], marketplaceLoadErrors, featuredPluginIds}`. Docs: "Don't call this from production clients yet" |
| `plugin/installed` | `{cwds?, installSuggestionPluginNames?}` → `{marketplaces, marketplaceLoadErrors}` |
| `plugin/read` | `{marketplacePath? \| remoteMarketplaceName?, pluginName}` → `{plugin: PluginDetail}` |
| `plugin/install` | `{marketplacePath? \| remoteMarketplaceName?, pluginName, installAttemptId?}` → `{authPolicy, appsNeedingAuth[]}` |
| `plugin/uninstall` | `{pluginId}` → `{}` |
| `plugin/search` (experimental), `plugin/reconcile`, `plugin/skill/read`, `plugin/share/*` | remote catalog / sharing |
| `app/list`, `app/read`, `app/installed` | connectors |
| `mcpServerStatus/list` | cursor/limit, `detail: "full"\|"toolsAndAuthOnly"`, `serverName?`, `threadId?` |
| `mcpServer/oauth/login` → notification `mcpServer/oauthLogin/completed`; `config/mcpServer/reload`; `mcpServer/startupStatus/updated`; `mcpServer/tool/call`; `mcpServer/resource/read` | MCP runtime |
| `config/read`, `config/value/write`, `config/batchWrite`, `configRequirements/read` | layered config; writes go to the user's `config.toml` |

**Key shapes:**
```ts
SkillMetadata = { name, description, shortDescription?, interface?: {displayName?, shortDescription?, iconSmall?, iconLarge?, iconSmallUrl?, iconLargeUrl?, brandColor?, defaultPrompt?},
  dependencies?: {tools: [{type, value, description?, transport?, command?, url?}]}, path, scope: "user"|"repo"|"system"|"admin", enabled, pluginId? }
PluginMarketplaceEntry = { name, path?: abs, interface?: {displayName?}, plugins: PluginSummary[] }
PluginSummary = { id, remotePluginId?, version?, localVersion?, name, shareContext?, source: {type:"local",path}|{type:"git",url,path?,refName?,sha?}|{type:"npm",package,version?,registry?}|{type:"remote"},
  installed, installedAt?, enabled, installPolicy: NOT_AVAILABLE|AVAILABLE|INSTALLED_BY_DEFAULT, installPolicySource?, authPolicy: ON_INSTALL|ON_USE,
  availability: AVAILABLE|DISABLED_BY_ADMIN, disabledReason?, eligiblePlanTypes?, interface?: {displayName, shortDescription, longDescription, developerName, category, capabilities[], websiteUrl, privacyPolicyUrl, termsOfServiceUrl, defaultPrompt[], brandColor, composerIcon, composerIconUrl, logo, …}, keywords[] }
PluginDetail = { marketplaceName, marketplacePath?, summary, shareUrl?, description?, skills[], onboardingSkill?, hooks[], apps[], appTemplates[], mcpServers: string[], scheduledTasks? }
HookMetadata = { key, eventName, handler: {command,async}|{mcpTool:{server,tool}}|prompt|agent, matcher?, timeoutSec, statusMessage?, sourcePath, source, pluginId?, enabled, isManaged, currentHash, trustStatus }
```
- The exact enum casing (serde renames) should be checked against the generated JSON schema: `codex app-server generate-json-schema`.

---

### 6. Practical implications for a multi-agent UI

1. **One install target for skills.** Write the skill once to `.agents/skills/<name>` (project) or `~/.agents/skills/<name>` (user). Then add a symlink for Claude Code: `.claude/skills/<name>` or `~/.claude/skills/<name>`. That reaches Codex, Gemini, Cursor, OpenCode and Copilot natively, and Claude via the symlink, which is officially supported. OpenCode, Cursor, Copilot and VS Code also read `.claude/skills`, so a `.claude/skills`-only install reaches everything except Codex and Gemini.
2. **Browse sources a UI can use without auth:**
   - Anthropic official marketplace.json (315) and anthropics/skills (5)
   - skills.sh `/api/search`
   - geminicli.com/extensions.json (2,198)
   - MCP registry `/v0.1/servers`
   - Smithery `/servers`
   - openai/plugins `.agents/plugins/marketplace.json` (65)
   - github/awesome-copilot (182)
3. **Install and enable through each agent's own CLI so its records stay correct:**
   - **Claude:** `claude plugin marketplace add …`, `claude plugin install p@mk --scope … --json`, then parse the last stdout line. For state, use `claude plugin list --json --available`.
   - **Codex:** `codex plugin add/list/remove --json`, or app-server `plugin/*` and `skills/config/write`.
   - **Gemini:** `gemini extensions install` / `gemini skills install`.
   - **Copilot:** `copilot plugin install`.
4. **Disabling a skill without deleting it:**
   - **Claude:** `skillOverrides: {"name": "off"}` in settings.
   - **Codex:** `[[skills.config]] path=… enabled=false`, or `skills/config/write`.
   - **Gemini:** `/skills disable`.
   - **OpenCode:** `permission.skill` set to `deny`.
5. **Validate before shipping:** `skills-ref validate <dir>` (spec), `claude plugin validate <dir> --json [--strict]` (plugins, marketplaces and skills dirs).


---

# Appendix B — Agents not installed here (web research)

## Extension surfaces of other coding-agent CLIs (researched 2026-10-20)

Scope: Gemini CLI, Cursor Agent CLI, GitHub Copilot CLI, Goose, Amp, Kimi CLI / Kimi Code, Qwen Code.
Method: read-only web research of official docs (plus source code for Gemini where docs were silent). Nothing installed locally, so **no command output was verified by running it**. "Not documented" means I could not find it in the official docs; it may still exist.

---

### Headline changes since mid-2026 (important for any integration)

| Agent | Status change |
|---|---|
| **Gemini CLI** | Replaced by **Antigravity CLI (`agy`)** for unpaid tier / Google AI Pro & Ultra / Google One users on **2026-06-18** (announced 2026-05-19). Gemini CLI keeps working for paid Gemini API keys and enterprise (Code Assist Standard/Enterprise). Extensions are renamed "Antigravity plugins"; `agy plugin import gemini` converts them. Every geminicli.com docs page now carries this banner. |
| **Kimi CLI** (`MoonshotAI/kimi-cli`, Python) | **Archived / unmaintained.** Successor is **Kimi Code** (`MoonshotAI/kimi-code`, Node, native binary, still `kimi`). Config home moves from `~/.kimi/` to `~/.kimi-code/` (`$KIMI_CODE_HOME`). `kimi migrate` imports config.toml, MCP config and sessions, **not** plugins or OAuth. |
| **Goose** | Moved from `block/goose` to the Agentic AI Foundation: repo **`aaif-goose/goose`**, docs **goose-docs.ai** (old block.github.io/goose URLs 404). Gained `goose plugin` (Open Plugins + Gemini extension formats) and `.agents/skills`. |
| **Amp** | **Custom slash commands removed** (Jan 2026) in favour of skills. Toolboxes (`AMP_TOOLBOX`) are legacy. Extensibility is now skills + TypeScript plugins. |
| **Cursor** | CLI binary is now documented as **`agent`** (older installs/docs use `cursor-agent`). Plugins + marketplace launched in Cursor 2.5 (Mar 2026). |
| **Copilot CLI** | Full plugin/marketplace system with `--json` on list commands; reads `.claude/` skills, agents, settings for compatibility. |

---

### 1. Gemini CLI (`google-gemini/gemini-cli`, binary `gemini`)

Docs root: https://geminicli.com/docs/ (banner: replaced by Antigravity CLI for consumer tiers on 2026-06-18).

#### 1.1 Settings files (precedence low → high)
- System defaults: `/Library/Application Support/GeminiCli/system-defaults.json` (macOS), `/etc/gemini-cli/system-defaults.json` (Linux), `C:\ProgramData\gemini-cli\system-defaults.json` (override `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`)
- User: `~/.gemini/settings.json`
- Project: `.gemini/settings.json`
- System (overrides all): `/Library/Application Support/GeminiCli/settings.json`, `/etc/gemini-cli/settings.json` (override `GEMINI_CLI_SYSTEM_SETTINGS_PATH`)
- Source: https://geminicli.com/docs/reference/configuration/

#### 1.2 Extensions (plugins)
- **Install dir:** `~/.gemini/extensions/<name>/` (`EXTENSIONS_DIRECTORY_NAME = path.join(GEMINI_DIR,'extensions')`). Each extension dir has `gemini-extension.json`, an install-metadata file `.gemini-extension-install.json`, and settings values in `.env` (constants from `packages/cli/src/config/extensions/variables.ts`).
- **CLI subcommands** (`packages/cli/src/commands/extensions/`: configure, disable, enable, install, link, list, new, uninstall, update, validate):
  - `gemini extensions install <github-url|local-path> [--ref <ref>] [--auto-update] [--pre-release] [--consent] [--skip-settings]` (installs a *copy*; git needed for GitHub)
  - `gemini extensions uninstall <name...>`
  - `gemini extensions list [-o|--output-format text|json]` → **`json` prints `JSON.stringify(extensions, null, 2)`** (array; `[]` when none). Source: `packages/cli/src/commands/extensions/list.ts`
  - `gemini extensions enable <name> [--scope user|workspace]` / `disable <name> [--scope user|workspace]`
  - `gemini extensions update <name> | --all`
  - `gemini extensions new <path> [template]` (templates: `mcp-server`, `context`, `custom-commands`, …)
  - `gemini extensions link <path>` (symlink for dev)
  - `gemini extensions config <name> [setting] [--scope user|workspace]` (file is `configure.ts`)
  - `gemini extensions validate <path>` (exists in source; not in docs)
- **Slash:** `/extensions list` (and others; management ops need restart).
- **`gemini-extension.json` fields:** `name` (lowercase, dashes, should match dir), `version`, `description`, `migratedTo` (new repo URL; CLI auto-migrates), `mcpServers` (all MCP options except `trust`; `settings.json` same-name wins), `contextFileName` (default `GEMINI.md` if present), `excludeTools` (e.g. `run_shell_command(rm -rf)`), `plan.directory`, `settings[]` (`name`, `description`, `envVar`, `sensitive` → keychain), `themes[]`. Variables: `${extensionPath}`, `${workspacePath}`, `${/}`.
- **Layout:** `gemini-extension.json`, `commands/*.toml` (`gcs/sync.toml` → `/gcs:sync`), `skills/<name>/SKILL.md`, `agents/*.md` (preview), `hooks/hooks.json` (hooks are NOT in manifest), `policies/*.toml`, `.env`, `GEMINI.md`.
- **Name clashes:** extension commands lowest precedence; on clash become `/<ext>.<cmd>` (e.g. `/gcp.deploy`).
- **Enablement mechanics:** enabled globally by default. State stored in **`~/.gemini/extensions/extension-enablement.json`**:
  ```json
  { "my-ext": { "overrides": ["/Users/me/projects/*", "!/Users/me/projects/secret/*"] } }
  ```
  Keys = extension names; `overrides` = path rules; leading `!` = disable, trailing `*` = include subdirs; **last matching rule wins**. `--scope workspace` writes a rule for the cwd path; user scope writes a broad rule. All rules live in the same user-level file (there is no per-project enablement file). CLI `-e/--extensions` overrides the file entirely (`none` disables all). Source: `packages/cli/src/config/extensions/extensionEnablement.ts`.
- **Restart:** all management operations take effect only after the CLI session restarts.
- **Admin/settings keys:** `admin.extensions.enabled`, `security.blockGitExtensions`, `security.allowedExtensions` (regex), `experimental.extensionManagement|extensionConfig|extensionRegistry|extensionRegistryURI|extensionReloading`.
- **Gallery:** https://geminicli.com/extensions/browse/ — auto-indexed by a daily crawler from public GitHub repos with topic **`gemini-cli-extension`** and `gemini-extension.json` at root (tagged repos). **Machine-readable index: `https://geminicli.com/extensions.json`** (~1.8 MB JSON array, ranked by stars). Entry fields: `id` (`@owner/name`), `rank`, `url`, `fullName`, `repoDescription`, `stars`, `lastUpdated`, `extensionName`, `extensionVersion`, `extensionDescription`, `avatarUrl`, `hasMCP`, `hasContext`, `hasHooks`, `hasSkills`, `hasCustomCommands`, `isGoogleOwned`, `licenseKey`. (Not documented officially; observed by fetching the URL.)
- Release formats: git repo, GitHub Releases ("Latest", `--pre-release`), or archives named `{platform}.{arch}.{name}.{tar.gz|zip}` / `{platform}.{name}...` / generic.
- Sources: https://geminicli.com/docs/extensions/reference/ , https://geminicli.com/docs/extensions/ , https://geminicli.com/docs/extensions/releasing/ , https://github.com/google-gemini/gemini-cli/tree/main/packages/cli/src/commands/extensions

#### 1.3 Skills (SKILL.md)
- Discovery (low → high precedence): built-in → extension `skills/` → user `~/.gemini/skills/` **or alias `~/.agents/skills/`** → workspace `.gemini/skills/` **or alias `.agents/skills/`**. Within a tier `.agents/skills` beats `.gemini/skills`.
- Name + description injected at session start; activation via `activate_skill` tool with user consent; skill dir added to allowed paths.
- CLI (`packages/cli/src/commands/skills/`: disable, enable, install, link, list, uninstall):
  - `gemini skills list [--all]` — **plain text only** (`Discovered Agent Skills:` then name `[Enabled]/[Disabled]` `[Built-in]`, `Description:`, `Location:`). No JSON flag.
  - `gemini skills install <git-url|local-dir> [--consent] [--path <subdir>] [--scope user|workspace]`
  - `gemini skills uninstall <name> [--scope]`
  - `gemini skills enable|disable <name>` and `gemini skills link <path>` exist in source (docs only show them as slash commands).
- Slash: `/skills list [all] [nodesc]`, `/skills link <path> [--scope]`, `/skills enable|disable <name> [--scope workspace]`, `/skills reload` (alias `refresh`) — reload without restart.
- Settings: `skills.enabled` (default true, restart needed), `skills.disabled: []`, `admin.skills.enabled`.
- Source: https://geminicli.com/docs/cli/skills/

#### 1.4 Custom slash commands (TOML)
- `~/.gemini/commands/` (user) and `<project>/.gemini/commands/` (project wins on clash); extension `commands/` lowest.
- Name from relative path, `/` → `:` (`git/commit.toml` → `/git:commit`).
- Fields: `prompt` (required), `description` (optional, shown in `/help`).
- `{{args}}` (raw; shell-escaped inside `!{}`), no `{{args}}` → args appended after two newlines. `!{cmd}` shell injection (confirmation prompt), `@{path}` file/dir injection (multimodal for images/PDF). Order: `@{}` then `!{}`/`{{args}}`.
- `/commands reload` after edits; `/commands list`.
- Source: https://geminicli.com/docs/cli/custom-commands/

#### 1.5 Subagents
- `.gemini/agents/*.md` (project), `~/.gemini/agents/*.md` (user), extension `agents/`.
- Frontmatter: `name` (required slug), `description` (required), `kind` (`local`|`remote` A2A), `tools` (wildcards `*`, `mcp_*`, `mcp_server_*`), `mcpServers` (inline, isolated), `model` (`inherit`), `temperature` (default 1), `max_turns` (30), `timeout_mins` (10). Body = system prompt.
- Enable: `experimental.enableAgents` (default true); per agent `agents.overrides.<name>.enabled`. `/agents` slash command.
- Source: https://geminicli.com/docs/core/subagents/

#### 1.6 Rules / memory
- `GEMINI.md` (global `~/.gemini/GEMINI.md`, project hierarchy). Configurable with `context.fileName` (string or array, e.g. `["AGENTS.md","GEMINI.md"]`). AGENTS.md is **not** loaded by default. Extensions can add `contextFileName`.

#### 1.7 Hooks
- `hooks.<Event>` in settings.json (project > user > system > extensions); extensions use `hooks/hooks.json`.
- Events: `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, `AfterTool`, `PreCompress`, `Notification`.
- Entry: `type: "command"` (only), `command`, `matcher` (regex for tool events, exact for lifecycle), `name`, `timeout` (ms, default 60000), `description`. Exit 0 = stdout JSON parsed, exit 2 = block (stderr reason).
- Toggles: `hooksConfig.enabled`, `hooksConfig.disabled` (names), `hooksConfig.notifications`. Slash: `/hooks panel|enable-all|disable-all|enable <n>|disable <n>`. Project hooks are fingerprinted (warn on change).
- Source: https://geminicli.com/docs/hooks/

#### 1.8 MCP
- `mcpServers` in `~/.gemini/settings.json` / `.gemini/settings.json`. Fields: `command`|`url` (SSE)|`httpUrl` (streamable HTTP), `args`, `cwd`, `env`, `headers`, `timeout` (600000), `trust`, `includeTools`, `excludeTools`, `oauth{...}`, `authProviderType`, `targetAudience`, `targetServiceAccount`.
- Global: `mcp.allowed`, `mcp.excluded`, `mcp.serverCommand`; admin `admin.mcp.enabled|config|requiredConfig`.
- CLI: `gemini mcp add <name> <commandOrUrl> [args...] [-s user|project (default project)] [-t stdio|sse|http] [-e K=V] [-H hdr] [--timeout] [--trust] [--description] [--include-tools] [--exclude-tools]`; `gemini mcp remove <name> [-s]`; `gemini mcp list` (**text only**, actually connects; lines like `✓ name: cmd (stdio) - Connected`, symbols ✓ … ⛔ ○ ✗); `gemini mcp enable|disable <name> [--session]` → persisted in **`~/.gemini/mcp-server-enablement.json`**.
- Slash: `/mcp`, `/mcp list`, `/mcp auth [server]`, `/mcp enable|disable <name>`.
- Source: https://geminicli.com/docs/tools/mcp-server/ , `packages/cli/src/commands/mcp/list.ts`

#### 1.9 Headless JSON
- `output.format` setting `text|json`; `-o/--output-format json|stream-json` for `-p` runs (headless page).

#### 1.10 Antigravity CLI (`agy`) migration notes
- `agy plugin import gemini` converts extensions (skills, agents, commands→skills, MCP).
- Global skills → `~/.gemini/antigravity-cli/skills/`; workspace skills `.gemini/skills/` → `.agents/skills/` (manual).
- MCP moves to `~/.gemini/config/mcp_config.json` and `.agents/mcp_config.json`; remote servers use `serverUrl`.
- GEMINI.md / AGENTS.md unchanged.
- Sources: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli , https://antigravity.google/docs/cli/gcli-migration

---

### 2. Cursor Agent CLI (binary `agent`; legacy name `cursor-agent`)

Docs: https://cursor.com/docs (index at https://cursor.com/llms.txt; the `.md` variants listed there 404, use the extension-less URLs).

#### 2.1 CLI commands and JSON
- Commands: `agent [prompt]`, `login`, `logout`, `status`/`whoami` (`--format text|json`), `about` (`--format text|json`), `models`, `mcp`, `sandbox`, `worker`, `acp`, `update`, `ls`, `resume`, `create-chat`, `generate-rule`/`rule`, `install-shell-integration`.
- Headless: `-p/--print`, `--output-format text|json|stream-json` (needs `-p`), `--stream-partial-output`, `-f/--force`/`--yolo`, `--trust`, `--approve-mcps`, `--workspace`, **`--plugin-dir <path>` (repeatable)**, `--mode plan|ask`, `-w/--worktree`.
- Source: https://cursor.com/docs/cli/reference/parameters

#### 2.2 MCP
- Config shared with editor: project `.cursor/mcp.json`, global `~/.cursor/mcp.json` (also discovered from parent dirs; precedence project → global → nested). Schema: `mcpServers.{name}` with `command`, `args`, `env`, `envFile` (stdio), `type`, `url`, `headers`, `auth{CLIENT_ID, CLIENT_SECRET, scopes}`. Interpolation `${env:X}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${/}`.
- CLI: `agent mcp list` (documented as an interactive menu showing status/source/transport), `agent mcp list-tools <id>`, `agent mcp login <id>`, `agent mcp enable <id>` (adds to local approved list), `agent mcp disable <id>`. **No `add`/`remove`, no JSON output documented.** `--approve-mcps` skips approvals. Slash `/mcp [list|list-tools] [id]`.
- Where enable state is stored: not documented.
- Sources: https://cursor.com/docs/cli/mcp , https://cursor.com/docs/mcp

#### 2.3 Rules / memory
- `.cursor/rules/**/*.mdc` (plain `.md` in that dir is ignored). Frontmatter: `description`, `globs` (comma-sep), `alwaysApply`. Types: Always / Apply Intelligently / Specific Files / Manual (`@rule`).
- `AGENTS.md` in root and subdirs (nested, more specific wins). CLI additionally reads **`CLAUDE.md`** at project root.
- User Rules (Settings UI), Team Rules (dashboard; precedence Team > Project > User).
- `agent generate-rule` creates rules.
- Sources: https://cursor.com/docs/context/rules , https://cursor.com/docs/cli/using

#### 2.4 Skills
- Project: `.agents/skills/`, `.cursor/skills/`; user: `~/.agents/skills/`, `~/.cursor/skills/`; compat: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`; nested repo subdirs (scoped). Discovered at startup.
- Frontmatter: `name` (required, = folder name), `description` (required), `paths` (globs), `disable-model-invocation`, `icon`, `color`, `metadata`.
- Invoke via `/skill-name` (one message) or Option/Alt+Enter as Custom Mode. Works in CLI (`/` menu).
- `/migrate-to-skills` (2.4+) converts rules and commands to skills.
- Source: https://cursor.com/docs/context/skills

#### 2.5 Custom slash commands
- `.cursor/commands/*.md` (project) and `~/.cursor/commands/*.md` (global); plain Markdown, file name = command. Marked beta; Cursor is steering toward skills (`/migrate-to-skills`). Team commands via dashboard. Official commands page is no longer reachable at the old docs.cursor.com URL; CLI support for them is not explicitly documented.
- Sources: https://docs.cursor.com/en/agent/chat/commands (legacy), https://cursor.com/docs/context/skills

#### 2.6 Subagents
- Project: `.cursor/agents/`, `.claude/agents/`, `.codex/agents/`; user: `~/.cursor/agents/`, `~/.claude/agents/`, `~/.codex/agents/`. Project > user; `.cursor` > `.claude`/`.codex`.
- Frontmatter: `name` (default filename), `description`, `model` (`inherit` or ID, `[effort=high]`), `readonly`, `is_background`. Built-ins: Explore, Browser. Works in CLI.
- Source: https://cursor.com/docs/context/subagents

#### 2.7 Hooks
- `hooks.json` locations (high → low): Enterprise (`/Library/Application Support/Cursor/hooks.json`, `/etc/cursor/hooks.json`, `C:\ProgramData\Cursor\hooks.json`), Team (dashboard), Project `.cursor/hooks.json`, User `~/.cursor/hooks.json`.
- Schema: `{ "version": 1, "hooks": { "<event>": [ { "command", "type": "command|prompt", "timeout" (s), "matcher", "loop_limit", "failClosed" } ] } }`.
- Events: `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, `afterAgentResponse`, `afterAgentThought`, `beforeTabFileRead`, `afterTabFileEdit`, `workspaceOpen`.
- Loads Claude Code hooks too (third-party hooks); `CLAUDE_PROJECT_DIR` alias set.
- CLI caveat: only `workspaceOpen` is explicitly stated to run in the CLI; forum reports (Aug 2026) that "Cursor CLI ignores hooks from marketplace plugin".
- Source: https://cursor.com/docs/hooks

#### 2.8 Plugins & marketplace
- Two formats: **Agent Plugin** (open standard: root `plugin.json` with `$schema`, `name`, …; `skills/` + `mcp.json`) and **Cursor Plugin** (`.cursor-plugin/plugin.json`).
- `.cursor-plugin/plugin.json`: `name` (required, kebab-case), `description`, `version`, `author{name,email}`, `homepage`, `repository`, `license`, `keywords`, `logo`, `rules`, `agents`, `skills`, `commands` (path or array), `hooks` (path or inline), `mcpServers` (path/inline/array), `variables` (JSON-schema object).
- Default dirs: `skills/*/SKILL.md`, `rules/` (.md/.mdc/.markdown), `agents/`, `commands/` (.md/.mdc/.markdown/.txt), `hooks/hooks.json`, `mcp.json`, root `SKILL.md` fallback.
- `.cursor-plugin/marketplace.json` (multi-plugin repo): `name`, `owner{name,email}`, `plugins[]` (`name`, `source`, metadata, component overrides), `metadata{description,version,pluginRoot}`; ≤10 MB.
- Vars: `${CURSOR_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` expanded; `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` NOT expanded.
- Local dev: `~/.cursor/plugins/local/<name>` then reload window. Marketplace: https://cursor.com/marketplace (manual review, open source required), publish at cursor.com/marketplace/publish. Team marketplaces (Default Off / Default On / Required).
- CLI: `/plugin [subcommand]` ("Manage plugins and marketplaces") interactive; `cursor-agent plugin marketplace add <repo-url>` exists; **no non-interactive `plugin install` as of July 2026** (forum staff). User-scope plugins installed in IDE sync to CLI. Install cache path on disk: not documented.
- Sources: https://cursor.com/docs/plugins , https://cursor.com/docs/reference/plugins , https://cursor.com/docs/cli/reference/slash-commands , https://forum.cursor.com/t/unable-to-find-a-cli-command-to-install-a-cursor-plugin-after-adding-its-marketplace-repository/166016

#### 2.9 CLI config
- `~/.cursor/cli-config.json` (global), `<project>/.cursor/cli.json` (permissions only). Keys: `version`, `editor.vimMode`, `permissions.allow|deny`, `approvalMode`, `sandbox.*`, `model`, etc. `CURSOR_CONFIG_DIR` override. No MCP/skills/plugins keys.
- Source: https://cursor.com/docs/cli/reference/configuration

---

### 3. GitHub Copilot CLI (binary `copilot`)

Docs: https://docs.github.com/en/copilot/reference/copilot-cli-reference/ (very large single pages).

#### 3.1 Config dir `~/.copilot` (`$COPILOT_HOME`)
- User-editable: `settings.json` (JSONC; replaces old `config.json` for settings), `copilot-instructions.md`, `instructions/*.instructions.md`, `mcp-config.json`, `lsp-config.json`, `providers.json`, `agents/`, `skills/`, `hooks/`, `extensions/`.
- CLI-managed: `config.json` (auth, installed plugin metadata, trusted folders), `permissions-config.json`, `installed-plugins/`, `plugin-data/`, `session-state/`, `session-store.db`, `logs/`, `mcp-oauth-config/`, `mcp-secrets/`.
- Settings precedence: defaults < MDM < `~/.copilot/settings.json` < `.github/copilot/settings.json` < `.github/copilot/settings.local.json` < env < flags. Also reads `.claude/settings.json` / `.claude/settings.local.json` for `enabledPlugins`, `extraKnownMarketplaces`, `hooks`, `disableAllHooks`.
- `copilot config [KEY] [VALUE] [--list [--json]] [--rm] [--global|--repo|--local]`.
- Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference

#### 3.2 Plugins + marketplaces
- `copilot plugin` (legacy alias `copilot plugins`):
  - `install SPEC` (alias `add`): `plugin@marketplace`, `OWNER/REPO`, `OWNER/REPO:PATH`, git URL, local path
  - `uninstall NAME` (`remove`, `rm`)
  - **`list [--json]`** → flat array `[{ name, marketplace?, version?, enabled, source, installedFrom? }]`
  - `update NAME | --all`
  - `enable NAME` / `disable NAME` (persist; future sessions)
  - `marketplace add SPEC` (`owner/repo`, `owner/repo#ref`, URL, path), **`marketplace list [--json]`**, **`marketplace browse NAME [--json]`**, `marketplace update [NAME]` (alias `refresh`), `marketplace remove NAME [--force]`
  - Removed flags `--kind/--scope/--mcp/--skill` → use `copilot mcp`, `copilot skill`, `copilot instruction`, `copilot lsp`.
- Default marketplaces: **`copilot-plugins`** and **`awesome-copilot`** (first-party plugins auto-update at session start in trusted dirs; disable via `autoUpdate: false` / `COPILOT_AUTO_UPDATE=false`).
- Manifest: Agent Plugins 1.0 root `plugin.json` (`$schema` required, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`; no component paths; `skills/`, `mcp.json`, Copilot-specific under `com.github.copilot/{agents,commands,rules,hooks/hooks.json,lsp.json}`). Legacy locations in order: `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, **`.claude-plugin/plugin.json`**; legacy fields incl. `agents`, `skills`, `commands`, `hooks`, `extensions`, `mcpServers`, `lspServers`, `category`, `tags`.
- `marketplace.json` locations: `marketplace.json`, `.plugin/`, `.github/plugin/` (recommended), `.claude-plugin/`. Fields: `name`, `owner{name,email}`, `plugins[]{name, source, …, strict}`, `metadata{description,version,pluginRoot}`. Source objects `{source:"github", repo, ref?, sha?, path?}`.
- Storage: `~/.copilot/installed-plugins/<MARKETPLACE>/<PLUGIN>`, direct installs `~/.copilot/installed-plugins/_direct/<SOURCE-ID>/`; cache `~/Library/Caches/copilot/marketplaces/` (macOS) / `~/.cache/copilot/marketplaces/` (`COPILOT_CACHE_HOME`).
- Settings: `enabledPlugins` (`"name@marketplace": true`), `extraKnownMarketplaces` (`source`: directory/git/github, `autoUpdate`), `strictKnownMarketplaces` (MDM). Repo `enabledPlugins` overlay makes `enable/disable` fail with an error naming the controlling file; MDM-pinned plugins can't be toggled.
- Precedence: project/personal agents & skills beat plugin ones (first found wins); MCP last-wins: `mcp-config.json` < plugin MCP < `--additional-mcp-config`.
- Restart: enable/disable apply to future sessions; `/restart` or new session for path-sourced plugin edits.
- Flags: `--plugin-dir=DIR`. Slash: `/plugin` dashboard (Installed / Online / Marketplace) with `install|update|uninstall|list|marketplace …`; `/env` shows loaded instructions, MCP, skills, agents, hooks, plugins, LSPs, extensions.
- Sources: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference , https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing , https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace

#### 3.3 Skills
- Locations: `.github/skills/`, `.agents/skills/`, `.claude/skills/`, `~/.copilot/skills/`, `~/.agents/skills/`, plugin dirs, `COPILOT_SKILLS_DIRS`, `skillDirectories` setting, `--add-dir` roots. First found wins.
- Frontmatter: `name` (≤64), `description` (≤1024), `argument-hint`, `allowed-tools`, `user-invocable` (default true → `/name`), `disable-model-invocation`.
- CLI: **`copilot skill list [--json]`** → rows `{ name, description, source, path, enabled }`; `copilot skill add <source> [--project]` (`--project` → `.github/skills`; dirs are registered not copied); `copilot skill remove <name|dir>`; `copilot skill enable|disable <name>`.
- Settings: `disabledSkills` (repo union), `ignoredSkillsLocations`, `skillDirectories`, `dynamicRetrieval.skills`.
- Slash: `/skills [list|info NAME|add [--project] SRC|remove|reload]`.
- Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

#### 3.4 Custom agents (subagents)
- Files `*.agent.md`. Locations (first wins): `~/.copilot/agents/`, project `.github/agents/` then `.claude/agents/` (cwd up to git root), `--add-dir` roots, plugin `agents/`, remote org/enterprise agents.
- ID from path (`agents/team/reviewer.agent.md` → `team--reviewer`).
- Frontmatter: `description` (required), `name`, `tools` (default `["*"]`), `model`, `models`, `modelPolicy` (`preferred|required`), `reasoningEffort`, `infer` (default true), `include-custom-instructions` (default false), `mcp-servers`, `hooks`, `sidekick{triggers,behavior,maxSendsPerTurn}`.
- Use: `--agent=NAME`, `/agent`, `/subagents` (alias `/agents`) for models. No CLI list command (needs live session).

#### 3.5 Custom instructions
- Loaded and merged: `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `.claude/rules/**/*.md`, plus `~/.copilot/` equivalents. Scoping via `applyTo`/`paths` frontmatter; `@path` imports. `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`, `--no-custom-instructions`.
- CLI: **`copilot instruction list [--json]`**; `copilot init`; slash `/instructions`, `/init`.

#### 3.6 Custom slash commands
- No standalone user commands directory. Equivalents: user-invocable skills (`/skill-name`) and plugin `commands` (legacy `commands` field / `com.github.copilot/commands/`). (Long-standing feature request: github/copilot-cli#302.)

#### 3.7 Hooks
- Locations: policy `/etc/github-copilot/policy.d/*.json`; repo `.github/hooks/*.json`; user `~/.copilot/hooks/*.json`; inline `hooks` key in `~/.copilot/settings.json`, `.github/copilot/settings(.local).json`, `.claude/settings(.local).json`; plugin `hooks.json`/`hooks/hooks.json`; agent frontmatter.
- Schema: `{ "version": 1, "hooks": { "preToolUse": [ { "type": "command|http|prompt", "bash", "powershell", "command", "exec", "args", "cwd", "env", "timeoutSec" (30), "matcher" } ] } }`.
- Events (camelCase or PascalCase — PascalCase = Claude/VS Code compatible payloads): `agentStop`/`Stop`, `errorOccurred`, `notification`, `permissionRequest`, `postToolUse`, `postToolUseFailure`, `preCompact`, `preToolUse`, `sessionEnd`, `sessionStart`, `subagentStart`, `subagentStop`, `userPromptSubmitted`, `userPromptTransformed`.
- Disable: `"disableAllHooks": true` (per file or repo settings).
- Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference

#### 3.8 MCP
- `~/.copilot/mcp-config.json` (`mcpServers`; local: `type local|stdio`, `command`, `args`, `env`, `cwd`, `tools`, `timeout`, …; remote: `type http|sse`, `url`, `headers`, `oauthClientId`, …). Workspace `.mcp.json` and `.github/mcp.json` override; `--additional-mcp-config` highest.
- CLI: **`copilot mcp list [--json]`** (grouped by source, `"enabled": false` for disabled), **`copilot mcp get <name> [--json]`**, `copilot mcp add [opts] <name> [url] [-- cmd args]` (`--transport http|sse`, `--env`, `--header`, `--tools`, `--timeout`, `--json`, `--show-secrets`), `copilot mcp enable|disable <name>`, `copilot mcp remove <name>` (user-level only).
- Settings: `disabledMcpServers`, `enabledMcpServers`, MDM `allowedMcpServers`/`deniedMcpServers`. Flags `--disable-builtin-mcps`, `--disable-mcp-server`, `--enable-mcp-server`.
- Slash: `/mcp [config|list|show|add|edit|delete|disable|enable|auth|reload|search]`.

---

### 4. Goose (now `aaif-goose/goose`, binary `goose`)

Docs: https://goose-docs.ai/docs/ (moved to the Agentic AI Foundation, Apr 2026; man page shows v1.45.0).

#### 4.1 Extensions (= MCP servers)
- Config: `~/.config/goose/config.yaml`, key `extensions:` map. Fields: `name`, `type` (`builtin`, `stdio`, `streamable_http`, platform…), `cmd`, `args`, `envs`, `env_keys`, `enabled`, `timeout`, `uri`, `bundled`, `display_name`, `description`, OAuth `client_id`/`client_secret_key`/`scopes`.
- Built-ins: Developer, Computer Controller, Memory, Tutorial, Auto Visualiser; platform: Analyze, Apps, Chat Recall, Code Mode, Extension Manager, Skills, Summon, Todo, Top of Mind.
- Manage: `goose configure` (interactive add/toggle/remove; must disable before remove). Per-session: `goose session|run --with-extension "<cmd>"`, `--with-streamable-http-extension <url>`, `--with-builtin <id>`; in-session `/extension <cmd>`, `/builtin <names>`. Toggles affect new sessions only. **No `goose mcp add/list`** (`goose mcp <name>` runs a bundled server).
- Deeplinks: `goose://extension?cmd=npx&arg=...&id=..&name=..&description=..&timeout=..` / `goose://extension?url=..&type=streamable_http&...`.
- Directory: https://goose-docs.ai/extensions ; **machine-readable index `documentation/static/servers.json`** in repo (raw: https://raw.githubusercontent.com/aaif-goose/goose/main/documentation/static/servers.json), ~57 entries: `id`, `name`, `description`, `command`, `url`, `type`, `link`, `installation_notes`, `is_builtin`, `endorsed`, `environmentVariables[]{name,description,required}`, `headers`.
- Source: https://goose-docs.ai/docs/getting-started/using-extensions

#### 4.2 Skills
- `~/.agents/skills/` (global), `.agents/skills/` (project), `~/.agents/plugins/<plugin>/` (plugin skills, namespaced `plugin:skill`). Back-compat: `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`, platform config dirs.
- Frontmatter: `name`, `description`. Loaded at session start via the built-in Skills platform extension (enabled by default; older v1.16–1.24 "Skills extension" deprecated, Summon in v1.25+).
- CLI: `goose skills list` (text, with token counts and source; no JSON). Slash: `/skills [name...]`.
- Source: https://goose-docs.ai/docs/guides/context-engineering/using-skills

#### 4.3 Plugins
- Formats: Open Plugins (`plugin.json` at root, or `.plugin/plugin.json`, `.goose-plugin/plugin.json`; fields `name`, `version`, `description`; `skills/`, `hooks/hooks.json`) and **Gemini extensions** (`gemini-extension.json` + `skills/`).
- Locations: `~/.agents/plugins/<name>/` (user), `<project>/.agents/plugins/<name>/` (project).
- CLI: `goose plugin install [--auto-update] <git-url>`, `goose plugin update <name>`. List/remove/enable not documented. Text output.
- Disable: `disabledPlugins: []` in `~/.config/goose/settings.json`, `<project>/.config/goose/settings.json`, or `<project>/.config/goose/settings.local.json`.
- No marketplace.
- Source: https://goose-docs.ai/docs/guides/context-engineering/plugins

#### 4.4 Hooks
- Only via plugins: `hooks/hooks.json` → `{ "hooks": { "SessionEnd": [ { "matcher"?, "hooks": [ { "type": "command", "command": "${PLUGIN_ROOT}/scripts/x.sh" } ] } ] } }` (Claude-style). Payload JSON on stdin; `PLUGIN_ROOT` env.
- Events: `SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `BeforeReadFile`, `AfterFileEdit`, `BeforeShellExecution`, `AfterShellExecution`.
- Sources: https://goose-docs.ai/docs/guides/context-engineering/hooks/ , https://goose-docs.ai/blog/2026/05/14/goose-hooks

#### 4.5 Rules / memory
- `AGENTS.md` and `.goosehints` (in that order) — global `~/.config/goose/.goosehints`, project root and nested dirs up to git root. `CONTEXT_FILE_NAMES` env (JSON array, default `["AGENTS.md", ".goosehints"]`, e.g. add `CLAUDE.md`). Requires Developer extension. `@file` inline include. Restart session to pick up edits.
- Source: https://goose-docs.ai/docs/guides/context-engineering/using-goosehints

#### 4.6 Recipes, custom slash commands, subagents
- Recipes (YAML/JSON with `instructions`, `prompt`, `parameters`, `extensions`, `sub_recipes`…). CLI: `goose recipe list [--format text|json] [-v]`, `validate`, `deeplink`, `open`; `goose run --recipe <name> --params k=v`.
- Custom slash commands = recipe shortcuts in `config.yaml`:
  ```yaml
  slash_commands:
    - command: "run-tests"
      recipe_path: "/path/to/recipe.yaml"
  ```
  (one parameter only; no CLI add/remove command).
- Subagents: via built-in **Summon** extension (v1.24+ unified subagents + skills); delegates to recipes/subagents; no agent-definition files. Disabled in manual/smart approval and chat-only modes.
- JSON elsewhere: `goose run --output-format json|stream-json`, `goose session list --format json`, `goose session export --format json`.
- Sources: https://goose-docs.ai/docs/guides/goose-cli-commands , https://goose-docs.ai/docs/guides/context-engineering/slash-commands , https://goose-docs.ai/docs/guides/context-engineering/subagents

---

### 5. Amp (Sourcegraph / ampcode.com, binary `amp`)

Docs: https://ampcode.com/manual (sidebar → `/docs/customize/*`, `/docs/cli/*`).

#### 5.1 Settings
- User `~/.config/amp/settings.json` (or `.jsonc`), workspace nearest `.amp/settings.json(c)` (overrides user), `--settings-file`, managed `/Library/Application Support/ampcode/managed-settings.json` / `/etc/ampcode/managed-settings.json`, plus workspace managed settings on ampcode.com.
- Source: https://ampcode.com/docs/cli/settings

#### 5.2 Rules / memory (AGENTS.md)
- `AGENTS.md` in cwd and parents up to `$HOME` (always); subdirectory AGENTS.md included when files in that subtree are read. Fallback per dir: **`AGENT.md`** then `CLAUDE.md`.
- Personal: `~/.config/amp/AGENTS.md`, `~/.config/AGENTS.md`. System: `/etc/ampcode/AGENTS.md`, `/Library/Application Support/ampcode/AGENTS.md`. Web: personal + workspace instructions.
- `@path` mentions (relative, `@~/`, globs); mentioned files can have `globs` frontmatter (included only after a matching file is read). `AMP_IGNORE_GUIDANCE_FILES` (colon globs; `*` disables).
- Source: https://ampcode.com/docs/customize/agents-md

#### 5.3 Skills
- Precedence (first match by name wins): `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, `.agents/skills/` (project + parents), `.claude/skills/`, `~/.claude/skills/`, `~/.claude/plugins/cache/`, `amp.skills.path`, personal skills repo, workspace skills repo, official Amp skills. Recursive up to 5 levels.
- Frontmatter: `name`, `description`, optional `mcpServers`; or sibling `mcp.json` (stdio `command/args/env`, remote `url/headers`, `includeTools`) — skill MCP tools hidden until skill loads.
- CLI: `amp skill add <source> [--global]` (→ `~/.config/agents/skills/`), **`amp skills list [--json]`**, `amp skills repositories`, `amp clone user-skills|workspace-skills`, `amp skill import`, `amp skill update`.
- Settings: `amp.skills.path`, `amp.skills.disableClaudeCodeSkills`, `amp.skills.disableGlobalAgentsSkills`. No per-skill disable key documented.
- Reload: ask Amp / `reload_skills` tool; no restart needed.
- Source: https://ampcode.com/docs/customize/skills

#### 5.4 Plugins (TypeScript, Bun runtime)
- Locations: project `.amp/plugins/`, system `~/.config/amp/plugins/` (`$XDG_CONFIG_HOME/amp/plugins`), personal & workspace hosted git repos. Precedence project > system > personal > workspace.
- Format: single `.ts`/`.js` or dir with `index.ts`; default export receives `PluginAPI`. Capabilities: `amp.registerTool`, `amp.registerCommand` (command palette), `amp.on(...)` events (`session.start`, `tool.call` [allow/reject/modify/synthesize], `tool.result`, `agent.start`, `agent.end` [continue], `changes.prompt`), UI dialogs, `amp.ai.ask/decide`, bundled skills, custom agent modes (`amp.createAgent`, `amp.registerAgentMode`), custom subagents (expose via tool).
- CLI: `amp plugins add <url> [--target workspace]`, `amp plugins list`, `amp plugins repositories`, `amp plugins import`, `amp plugins update`, `amp plugins show-agent-options`, `amp clone user-plugins|workspace-plugins`. Reload via Ctrl+O `plugins: reload`. `--plugin-ready-timeout` for `-x`.
- No marketplace; sharing via share URLs.
- Sources: https://ampcode.com/docs/customize/plugins , https://ampcode.com/docs/plugin-api , https://ampcode.com/docs/customize/global-plugins-and-skills

#### 5.5 Custom commands / hooks / subagents
- **Custom commands removed** (Jan 2026): migrate `.agents/commands/` & `~/.config/amp/commands` to skills. Source: https://ampcode.com/news/slashing-custom-commands
- **Hooks:** only through plugin events (`amp.on`); no hooks config file documented.
- **Subagents:** built-in Search, Oracle, Librarian, Task, Read Thread; custom ones only via plugins. Source: https://ampcode.com/docs/models-and-subagents
- **Toolboxes:** legacy `AMP_TOOLBOX` dirs of executables; `amp tools make|show|use`. Source: https://ampcode.com/news/toolboxes

#### 5.6 MCP
- `amp.mcpServers` in user/workspace settings or `--mcp-config <json>`; precedence `--mcp-config` > workspace > user > skills. Fields: `command`, `args`, `env` (`${VAR}`), `url`, `headers`.
- Workspace servers require approval: `amp mcp approve <name>`; status via `amp mcp doctor`.
- CLI: `amp mcp add <name> -- <cmd...>` or `<url>`, `amp mcp approve`, `amp mcp doctor`, `amp mcp oauth login|logout <name>`, `amp mcp remote {add|update|remove|list|tools|check|login|logout} --personal|--workspace <ws>|--project <p>|--current-project` (**`--json` supported on remote subcommands**). Local `list`/`remove` and JSON for `doctor` not documented.
- Settings: `amp.mcpPermissions` (allow/reject rules), `amp.tools.disable` (tool names/globs).
- Headless: `amp -x/--execute`, `--stream-json`.
- Source: https://ampcode.com/docs/customize/mcp

---

### 6. Kimi CLI → Kimi Code (MoonshotAI, binary `kimi`)

#### 6.0 Legacy kimi-cli (archived)
- Home `~/.kimi/` (`config.toml`, `mcp.json`, logs). `kimi mcp add|list|remove|auth|test`, `--mcp-config-file` (repeatable), `--skills-dir`, `--agent default|okabe`, `--agent-file` (YAML agent spec), `--print --output-format text|stream-json`. Plugins existed but are **not** migrated.
- Sources: https://moonshotai.github.io/kimi-cli/en/ , https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html

#### 6.1 Kimi Code layout
- Home `~/.kimi-code/` (`$KIMI_CODE_HOME`): `config.toml`, `tui.toml`, `mcp.json`, `skills/`, `agents/`, `plugins/managed/<id>/`, `AGENTS.md`, `SYSTEM.md`. Project `.kimi-code/` (`local.toml`, `mcp.json`, `skills/`, `agents/`, `AGENTS.md`).
- `kimi migrate` (from `~/.kimi/`), `kimi doctor [config|tui]`, `/reload` reapplies config.
- Docs: https://moonshotai.github.io/kimi-code/en/ (also mirrored at https://www.kimi.com/code/docs/en/kimi-code-cli/)

#### 6.2 Skills
- User `~/.kimi-code/skills/` and `~/.agents/skills/`; project `.kimi-code/skills/` and `.agents/skills/` (project root = nearest `.git`); `extra_skill_dirs` (config.toml); built-in (`builtin_product_skills`). Precedence Project > User > Extra > Built-in. `--skills-dir` replaces auto-discovery. `merge_all_available_skills`.
- Forms: `<name>/SKILL.md` or flat `<name>.md`.
- Frontmatter: `name`, `description`, `type` (`prompt|inline|flow`), `whenToUse`, `disableModelInvocation`, `arguments`; body placeholders `$ARGUMENTS`, `$0`, `$<name>`, `${KIMI_SKILL_DIR}`.
- Invoke `/skill:<name> [args]` or `/<name>` shorthand; nested `/<parent>.<sub>`. New session needed for new skills. No skills CLI subcommand.
- Source: https://moonshotai.github.io/kimi-code/en/customization/skills

#### 6.3 Plugins + marketplace
- Manifest `kimi.plugin.json` (wins) or `.kimi-plugin/plugin.json`. `name` (`[a-z0-9][a-z0-9_-]{0,63}`), `version`, `description`, `keywords`, `author`, `homepage`, `license`, `interface{displayName, shortDescription, longDescription, developerName, websiteURL}`; runtime `skills`, `agents`, `sessionStart.skill`, `skillInstructions`, `systemPrompt`, `systemPromptPath`, `mcpServers`, `hooks`, `commands` (Markdown → `/<plugin>:<command>`). Unsupported (`tools`, `apps`, `inject`, `configFile`) ignored with diagnostics.
- Install copies to `$KIMI_CODE_HOME/plugins/managed/<id>/`; per-user only (no project scope); enable state in `installed.json`. Remove deletes the record only.
- **TUI only** (no `kimi plugin` CLI): `/plugins` (Installed / Official / Curated / Custom tabs), `/plugins list|install <path|zip-url|github-url>|marketplace [source]|info <id>|enable <id>|disable <id>|remove <id>|reload`, `/plugins mcp enable|disable <id> <server>`.
- Marketplace JSON: `{ "version": "2", "plugins": [ { "id", "source", "displayName"? } ] }`; override default catalog with `KIMI_CODE_PLUGIN_MARKETPLACE_URL`. Trust badges kimi-official/curated/third-party. Installing never executes plugin scripts.
- Changes apply after `/reload` or `/new`.
- Source: https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html

#### 6.4 Subagents / custom agents
- User `~/.kimi-code/agents/`, `~/.agents/agents/`; project `.kimi-code/agents/`, `.agents/agents/`; `extra_agent_dirs`; plugin `agents/`; built-in `coder`, `explore`, `plan`. Priority `--agent-file` > project > extra > user > plugin > built-in. Recursive `.md` scan.
- Frontmatter: `name`, `description` (required), `whenToUse`, `override`, `tools` (`mcp__server__*` globs), `disallowedTools`, `subagents`. Body can use `${base_prompt}`, `${plugin_sections}`.
- Select: `--agent <name>`, `--agent-file <path>` (new sessions only).
- Source: https://moonshotai.github.io/kimi-code/en/customization/agents

#### 6.5 Rules / memory
- `~/.kimi-code/AGENTS.md`, `~/.agents/AGENTS.md`, project `.kimi-code/AGENTS.md` or `AGENTS.md`; injected via `${agents_md}`. `/init` generates AGENTS.md. `/import-from-cc-codex` imports Claude Code / Codex settings.

#### 6.6 Hooks
- `[[hooks]]` array in `~/.kimi-code/config.toml` (also in plugin manifests). Exactly four fields: `event`, `matcher` (regex), `command`, `timeout` (1–600 s, default 30) — extra fields break config load.
- Events: `UserPromptSubmit`, `UserPromptQueued`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionResult`, `Stop`, `StopFailure`, `Interrupt`, `TurnStarted`, `SessionStart`, `SessionEnd`, `SessionHeartbeat`, `SubagentStart`, `SubagentStop`, `TaskStarted`, `PreCompact`, `PostCompact`, `Notification`. Blockable only: `UserPromptSubmit`, `PreToolUse`, `Stop` (exit 2 or `hookSpecificOutput.permissionDecision: "deny"`); fail-open.
- Source: https://moonshotai.github.io/kimi-code/en/customization/hooks

#### 6.7 MCP
- `~/.kimi-code/mcp.json` (user) and `.kimi-code/mcp.json` (project overrides). `mcpServers` entries: `command`/`args`/`env`/`cwd` (stdio), `url` (HTTP) or `transport: "sse"`, `headers`, `bearerTokenEnvVar`, **`enabled`** (false = disabled), `deferred`, `startupTimeoutMs`, `toolTimeoutMs`, `enabledTools`/`disabledTools`. `[mcp]` table in config.toml for defaults.
- **No `kimi mcp` CLI documented in Kimi Code**; use `/mcp-config` (add/edit/delete, `login <server>`) and `/mcp` (status). Servers added mid-session join only new sessions. Untrusted project stdio servers need trust; `KIMI_CODE_TRUST_WORKSPACE=1` for headless.
- Headless: `kimi -p ... --output-format text|stream-json` (no plain `json`). `kimi provider list --json`.
- Source: https://moonshotai.github.io/kimi-code/en/customization/mcp

---

### 7. Qwen Code (`QwenLM/qwen-code`, binary `qwen`; Gemini CLI fork)

Docs: https://qwenlm.github.io/qwen-code-docs/en/

#### 7.1 Settings
- System defaults `/Library/Application Support/QwenCode/system-defaults.json` (`QWEN_CODE_SYSTEM_DEFAULTS_PATH`), user `~/.qwen/settings.json`, project `.qwen/settings.json`, system `/Library/Application Support/QwenCode/settings.json` (`QWEN_CODE_SYSTEM_SETTINGS_PATH`).
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/

#### 7.2 Extensions (plugins) — also installs Claude Code plugins and Gemini extensions
- Install dir `~/.qwen/extensions/<name>/` with `qwen-extension.json`.
- `qwen extensions install <source> [--scope project|workspace] [--registry <npm-url>]` — sources: git URL, `owner/repo`, local dir, `.zip`/`.tar.gz`, archive URL, scoped npm package, **Claude Code marketplace `owner/repo:plugin`** (auto-converted), **Gemini extensions** (TOML commands → Markdown), Qoder plugins (`.qoder-plugin/plugin.json`), Agent Plugins v1 (`plugin.json`, `mcp.json`, `SKILL.md` as-is).
- `uninstall <name>`, `update <name>|--all`, `enable|disable <name> [--scope=workspace]`, `link <path>`, `settings set <ext> <setting> [--scope user|workspace]`, `settings list <ext>`, `sources add|list|update|remove` (marketplace sources for Discover tab), `list` (**plain text only** — no flags in `list.ts`).
- `qwen-extension.json`: `name`, `version`, `mcpServers` (no `trust`), `channels`, `contextFileName` (default `QWEN.md`), `commands`, `skills`, `agents`, `workflows` (dir paths), `settings[]` (`name`, `description`, `envVar`, `sensitive`). Extension settings values in `~/.qwen/.env` / `.qwen/.env`.
- Enablement: user scope by default; workspace scope for current project. Storage file not documented (likely inherited from Gemini's `extension-enablement.json` design — unverified).
- Restart: CLI-made changes need session restart; `/extensions …` slash changes hot-reload. `/reload-plugins` reloads commands/skills/agents/workflows/hooks/MCP/LSP from disk.
- Session flags: `-e/--extensions <names>` (`none` disables all), `-l/--list-extensions`.
- Gallery: `/extensions explore Gemini|ClaudeCode` (opens browser), `/extensions manage` (Discover / Installed / Sources), `/extensions list`, `/extensions install <repo|path>` (no confirmation prompt!).
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction/

#### 7.3 Skills
- `~/.qwen/skills/`, `.qwen/skills/`, extension `skills/`, bundled. Precedence project > user > extension > bundled. (`.agents/skills` / `.claude/skills` not documented.)
- Frontmatter: `name`, `description`, `priority`, `paths`, `user-invocable`, `disable-model-invocation`, `hooks`, `allowedTools`.
- `/skills` panel (toggle), `/<skill-name>`, `/learn <source>`, `/curator …`. Auto-reload on file changes (not in `--bare`).
- Settings: `skills.disabled`, `skills.enabled`, `skills.defaultDisabled`, `skills.disabledLevels` (`project|user|extension|bundled`). Precedence disabled > enabled > defaultDisabled.
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/

#### 7.4 Custom slash commands
- `~/.qwen/commands/` and `.qwen/commands/` (project wins); extension `commands/`. **Markdown** (recommended; optional frontmatter `description`) or TOML (deprecated, auto-migration prompt). Path → `/a:b`. `{{args}}`, `!{cmd}`, `@{file}` like Gemini. `slashCommands.disabled` setting / `--disabled-slash-commands` / `QWEN_DISABLED_SLASH_COMMANDS`.
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/

#### 7.5 Subagents
- `.qwen/agents/` (project) > `~/.qwen/agents/` (user); extension `agents/`. Markdown + YAML: `name`, `description`, `model` (`inherit|fast|<id>|authType:modelId`), `approvalMode`, `tools`, `disallowedTools`; Claude-compat `permissionMode`, `maxTurns`, `color`, `mcpServers`, `hooks`. `/agents create|manage`.
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/

#### 7.6 Rules / memory
- `QWEN.md` (default `context.fileName`; can be array). AGENTS.md not default. `/memory`, `/remember`, `/forget`, `/dream`.

#### 7.7 Hooks
- `hooks` key in settings.json (user/workspace/system; project hooks only in trusted folders), agent/skill frontmatter, extensions. Claude-style: `{ "PreToolUse": [ { "matcher": "...", "hooks": [ { "type": "command|http|prompt", "command", "timeout" (s), "async", "env", "shell", ... } ] } ] }`.
- Events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `SessionDelete`, `MessageDisplay`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `Notification`, `PermissionRequest`, `PermissionDenied`, `TodoCreated`, `TodoCompleted`, `InstructionsLoaded`.
- `disableAllHooks: true`; `--safe-mode`/`--bare` disable hooks. `/hooks`, `/hooks list` (read-only browser).
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/

#### 7.8 MCP
- `mcpServers` in `~/.qwen/settings.json` / `.qwen/settings.json`; Gemini-like fields + `versionNegotiation`, `discoveryTimeoutMs`, `appResource*`.
- `qwen mcp add [-s user|project (default user)] [-t stdio|sse|http] [-e] [-H] [--timeout] [--trust] [--description] [--include-tools] [--exclude-tools] [--oauth-*] <name> <commandOrUrl> [args...]`, `qwen mcp remove <name>`, `qwen mcp list` (text). No enable/disable or JSON documented.
- `mcp.allowed`, `mcp.excluded` (globs), `mcp.serverCommand`, `mcp.toolIdleTimeoutMs`. `/mcp` dialog, `/import-config` (imports Claude MCP config).
- Headless: `-o/--output-format text|json|stream-json`.
- Source: https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/

---

### Cross-agent comparison

#### Skills (SKILL.md) directories
| Agent | User | Project | Reads `.agents/skills`? | Reads `.claude/skills`? | List CLI with JSON |
|---|---|---|---|---|---|
| Gemini | `~/.gemini/skills`, `~/.agents/skills` | `.gemini/skills`, `.agents/skills` | yes (wins) | no | `gemini skills list` text only |
| Cursor | `~/.cursor/skills`, `~/.agents/skills` | `.cursor/skills`, `.agents/skills` | yes | yes (+ `.codex/skills`) | none |
| Copilot | `~/.copilot/skills`, `~/.agents/skills` | `.github/skills`, `.agents/skills`, `.claude/skills` | yes | yes | `copilot skill list --json` |
| Goose | `~/.agents/skills` | `.agents/skills` (+`.goose/skills`) | yes (recommended) | yes | `goose skills list` text |
| Amp | `~/.config/agents/skills`, `~/.agents/skills`, `~/.config/amp/skills` | `.agents/skills` | yes | yes (+ `~/.claude/plugins/cache`) | `amp skills list --json` |
| Kimi Code | `~/.kimi-code/skills`, `~/.agents/skills` | `.kimi-code/skills`, `.agents/skills` | yes | not documented | none |
| Qwen | `~/.qwen/skills` | `.qwen/skills` | not documented | not documented | none |

#### Plugin / extension systems
| Agent | Unit | Manifest | Install dir | Non-interactive CLI | JSON list | Marketplace |
|---|---|---|---|---|---|---|
| Gemini | extension | `gemini-extension.json` | `~/.gemini/extensions/<n>` | full (`gemini extensions …`) | `list -o json` | gallery + `https://geminicli.com/extensions.json` |
| Cursor | plugin | `.cursor-plugin/plugin.json` or `plugin.json` | not documented (`~/.cursor/plugins/local` for dev) | only `plugin marketplace add`; install is `/plugin` | no | cursor.com/marketplace; team marketplaces |
| Copilot | plugin | `plugin.json` / `.github/plugin/` / `.claude-plugin/` | `~/.copilot/installed-plugins/<mkt>/<p>` | full (`copilot plugin …`) | `plugin list --json`, `marketplace list/browse --json` | `copilot-plugins`, `awesome-copilot`, any repo with `marketplace.json` |
| Goose | plugin / extension(MCP) | `plugin.json` or `gemini-extension.json` | `~/.agents/plugins/<n>` | `goose plugin install/update` | no | none (extensions directory `servers.json`) |
| Amp | TS plugin | none (code) | `~/.config/amp/plugins`, `.amp/plugins` | `amp plugins add/list/…` | not documented | none |
| Kimi Code | plugin | `kimi.plugin.json` / `.kimi-plugin/plugin.json` | `~/.kimi-code/plugins/managed/<id>` | none (TUI `/plugins`) | no | official catalog; `KIMI_CODE_PLUGIN_MARKETPLACE_URL` |
| Qwen | extension | `qwen-extension.json` (+ converts Claude/Gemini/Qoder/Agent Plugins) | `~/.qwen/extensions/<n>` | full (`qwen extensions …`) | no (`list` text) | `sources` + Discover tab; explore Gemini/Claude marketplaces |

#### MCP management CLIs
| Agent | Config file(s) | add/remove CLI | list JSON |
|---|---|---|---|
| Gemini | `~/.gemini/settings.json`, `.gemini/settings.json`; enablement `~/.gemini/mcp-server-enablement.json` | `gemini mcp add/remove/enable/disable` | no |
| Cursor | `~/.cursor/mcp.json`, `.cursor/mcp.json` | none (only enable/disable/login/list-tools) | no |
| Copilot | `~/.copilot/mcp-config.json`, `.mcp.json`, `.github/mcp.json` | `copilot mcp add/remove/enable/disable` | `copilot mcp list --json`, `get --json` |
| Goose | `~/.config/goose/config.yaml` `extensions:` | none (interactive `goose configure`) | no |
| Amp | `amp.mcpServers` in `~/.config/amp/settings.json`, `.amp/settings.json` | `amp mcp add`, `amp mcp remote …` | `amp mcp remote … --json` |
| Kimi Code | `~/.kimi-code/mcp.json`, `.kimi-code/mcp.json` | none (TUI `/mcp-config`); legacy kimi-cli had `kimi mcp add/list/remove` | no |
| Qwen | `~/.qwen/settings.json`, `.qwen/settings.json` | `qwen mcp add/remove/list` | no |

#### Rules / memory files
| Agent | Files |
|---|---|
| Gemini | `GEMINI.md` (configurable `context.fileName`; AGENTS.md opt-in) |
| Cursor | `.cursor/rules/*.mdc`, `AGENTS.md` (nested), CLI also `CLAUDE.md` |
| Copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/rules/**`, `~/.copilot/copilot-instructions.md` |
| Goose | `AGENTS.md`, `.goosehints` (`CONTEXT_FILE_NAMES`) |
| Amp | `AGENTS.md` (fallback `AGENT.md`, `CLAUDE.md`), `~/.config/amp/AGENTS.md` |
| Kimi Code | `AGENTS.md`, `.kimi-code/AGENTS.md`, `~/.kimi-code/AGENTS.md`, `~/.agents/AGENTS.md` |
| Qwen | `QWEN.md` (configurable `context.fileName`) |

#### Subagent definition files
| Agent | Locations | Format |
|---|---|---|
| Gemini | `.gemini/agents/*.md`, `~/.gemini/agents/*.md` | MD + YAML (`name`, `description`, `kind`, `tools`, `model`, …) |
| Cursor | `.cursor/agents`, `.claude/agents`, `.codex/agents` (+ `~/` variants) | MD + YAML (`name`, `description`, `model`, `readonly`, `is_background`) |
| Copilot | `~/.copilot/agents`, `.github/agents`, `.claude/agents` | `*.agent.md` |
| Goose | none (recipes via Summon) | recipe YAML |
| Amp | none (plugins `amp.createAgent`) | TypeScript |
| Kimi Code | `.kimi-code/agents`, `.agents/agents`, `~/.kimi-code/agents`, `~/.agents/agents` | MD + YAML |
| Qwen | `.qwen/agents`, `~/.qwen/agents` | MD + YAML (Claude-compatible fields parsed) |

#### Hooks
| Agent | Where | Naming |
|---|---|---|
| Gemini | settings.json `hooks`, extension `hooks/hooks.json` | `BeforeTool`/`AfterTool`/… |
| Cursor | `~/.cursor/hooks.json`, `.cursor/hooks.json`, enterprise; also Claude hooks | camelCase `preToolUse`… |
| Copilot | `~/.copilot/hooks/*.json`, `.github/hooks/*.json`, settings `hooks`, `.claude/settings.json`, plugins | camelCase or PascalCase |
| Goose | plugin `hooks/hooks.json` only | PascalCase (Claude-style) |
| Amp | plugin `amp.on(...)` | `tool.call`, … |
| Kimi Code | `[[hooks]]` in config.toml, plugin manifest | PascalCase |
| Qwen | settings.json `hooks` (Claude-style), frontmatter | PascalCase |

---

### Caveats / unverified items
- Nothing was executed locally; JSON shapes are from docs/source only.
- Gemini `extension-enablement.json` path is inferred from `ExtensionStorage.getUserExtensionsDir()` → `~/.gemini/extensions` (constant `EXTENSIONS_DIRECTORY_NAME`); format confirmed from source.
- `https://geminicli.com/extensions.json` is undocumented (found by probing); may change, especially with the Antigravity transition.
- Cursor: `agent mcp list` documented as interactive; behaviour in non-TTY not documented. Plugin install path on disk not documented. `/plugin` subcommands not enumerated in docs. Hooks/plugins in the CLI have known gaps per the forum.
- Copilot: settings key for disabling individual plugins at user level is `enabledPlugins` map (false) — documented for repo/MDM; `copilot plugin disable` is the supported way.
- Qwen: extension enablement storage file and `.agents/skills` support not documented.
- Kimi Code: no non-interactive plugin/MCP/skills commands; everything is TUI slash commands or editing `mcp.json` / `config.toml`.
