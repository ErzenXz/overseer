// The docs, in sidebar order. Each page's text lives in
// src/content/docs/<slug>.md (the introduction is "index.md"). vite.config.ts
// reads this list to write one static HTML entry per page, so adding a page
// here and its Markdown file is all it takes.

export interface DocPage {
  slug: string; // "" is /docs/
  title: string;
  description: string;
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    title: "Getting Started",
    pages: [
      { slug: "", title: "Introduction", description: "What Overseer is, how the hub, your machines and your agents fit together, and where to go next." },
      { slug: "quick-start", title: "Quick Start", description: "Install the hub, add your first machine and start an agent session in a few minutes." },
    ],
  },
  {
    title: "Using Overseer",
    pages: [
      { slug: "sessions", title: "Sessions", description: "Start agent sessions, choose the model and mode, approve what runs, send later, continue in another agent and share a session." },
      { slug: "workspace", title: "Workspace & Previews", description: "The panel beside every session: live previews, shell, remote desktop, files, changes with before and after screenshots, and plan." },
      { slug: "agents", title: "Agents & Skills", description: "Which agents Overseer finds, adding your own, and managing skills, plugins and MCP servers for all of them." },
      { slug: "machines", title: "Machines", description: "Add computers or one-click cloud servers to your hub, see their live stats, and install or sign in to agent CLIs on them." },
      { slug: "automations", title: "Automations & Review", description: "Run prompts on a schedule, share them as recipes, turn labelled GitHub issues into pull requests, and review pull requests with an agent." },
      { slug: "arena", title: "Agent Arena", description: "Give one task to several agents, compare their results side by side, and keep the best one." },
      { slug: "mission", title: "Mission Control & Wrapped", description: "Watch every agent on one live wall, show it on a TV, and post a recap of what your agents got done." },
    ],
  },
  {
    title: "Automation",
    pages: [
      { slug: "cli", title: "Command Line", description: "Drive your fleet from a shell: list machines, start sessions, type into them, read output, forward ports and watch it all with overseer top." },
      { slug: "mcp", title: "MCP & Agents", description: "Let Claude Code, Codex, ChatGPT or any MCP client run sessions on your machines through Overseer's MCP tools." },
    ],
  },
  {
    title: "Reference",
    pages: [
      { slug: "remote-access", title: "Remote Access", description: "Reach your hub from anywhere over Tailscale, built-in HTTPS or your own reverse proxy." },
      { slug: "teams", title: "Teams & Chat Apps", description: "Let more than one person use a hub with roles, invites and hand-offs, and answer agents from Telegram, Slack or Discord." },
      { slug: "updates", title: "Updates & Services", description: "How verified automatic updates and rollback work, and how to run the hub under your own service." },
      { slug: "shortcuts", title: "Keyboard Shortcuts", description: "Every keyboard shortcut in the Overseer web app." },
    ],
  },
];

export const DOC_PAGES: (DocPage & { group: string })[] = DOC_GROUPS.flatMap((group) => group.pages.map((page) => ({ ...page, group: group.title })));

export const docHref = (slug: string) => (slug ? `/docs/${slug}/` : "/docs/");
