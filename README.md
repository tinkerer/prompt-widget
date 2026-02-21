# Prompt Widget

Feedback overlay + agent session bridge for web apps. Drop a script tag into your app, collect feedback with screenshots, and dispatch AI agents that can see and interact with live browser sessions.

Four packages: **widget** (embeddable JS overlay), **server** (Hono API + SQLite), **admin** (Preact SPA dashboard), **shared** (types/schemas).

## Quick start

```bash
git clone https://github.com/tinkerer/prompt-widget.git
cd prompt-widget
npm install
npm run dev
```

This starts both the API server and the session service. Admin dashboard at `http://localhost:3001/admin/` (login: admin/admin).

## Architecture

```
Browser (your app)          Server (:3001)              Agent
┌──────────────┐     WS     ┌──────────────┐     PTY    ┌──────────┐
│ prompt-widget │ ─────────> │  session mgr │ ─────────> │ claude   │
│   overlay     │ <───────── │  + REST API  │ <───────── │   CLI    │
└──────────────┘  commands   └──────────────┘  output    └──────────┘
                                   │
                              SQLite (Drizzle)
```

The widget opens a WebSocket to the server. Agents interact with the live page through REST endpoints — the server relays commands over the WebSocket and returns results.

## What the widget does

The `<script>` tag creates a feedback button overlay. Configure via data attributes:

```html
<script src="http://localhost:3001/widget/prompt-widget.js"
  data-endpoint="http://localhost:3001"
  data-app-key="pw_YOUR_KEY"
  data-position="bottom-right"
  data-collectors="console,network,performance,environment">
</script>
```

**Feedback collection:** textarea with screenshot capture (html-to-image), paste-to-attach images, submission history via arrow keys.

**Data collectors** (opt-in via `data-collectors`):
- `console` — intercepts console.log/warn/error/info/debug
- `network` — hooks fetch to track HTTP errors
- `performance` — page load time, DOM content load, FCP
- `environment` — user agent, viewport, screen resolution, URL

**Session bridge:** WebSocket connection that lets agents execute commands in the page — JS evaluation, DOM queries, click, type, navigate, mouse/keyboard events, screenshots.

**Custom hooks** — expose app-specific data to agents:

```js
window.agent = {
  getCartItems:    () => store.getState().cart.items,
  getFormErrors:   () => [...document.querySelectorAll('[data-error]')].map(el => el.textContent),
  getCurrentRoute: () => router.currentRoute.value,
};
```

Agents call hooks via `POST /api/v1/agent/sessions/:id/execute`.

## Agent API

Agents interact with pages that have the widget embedded.

### Page inspection

```bash
BASE="http://localhost:3001/api/v1/agent/sessions/SESSION_ID"

curl -s "$BASE/screenshot"                    # Capture page screenshot
curl -s "$BASE/console"                       # Console logs
curl -s "$BASE/network"                       # Network errors
curl -s "$BASE/environment"                   # Browser/page environment
curl -s "$BASE/dom?selector=body"             # DOM snapshot with accessibility tree
curl -s -X POST "$BASE/execute" \
  -H 'Content-Type: application/json' \
  -d '{"expression": "return document.title"}'  # Run JS in page
```

### Mouse and keyboard

```bash
# Click at coordinates (fires full mousedown + mouseup + click sequence)
curl -s -X POST "$BASE/mouse/click" -H 'Content-Type: application/json' -d '{"x":500,"y":300}'

# Hover (fires mouseenter + mouseover + mousemove)
curl -s -X POST "$BASE/mouse/hover" -H 'Content-Type: application/json' -d '{"selector":"button.menu"}'

# Drag from A to B with interpolated steps
curl -s -X POST "$BASE/mouse/drag" -H 'Content-Type: application/json' \
  -d '{"from":{"x":100,"y":200},"to":{"x":400,"y":200},"steps":10}'

# Type text into element
curl -s -X POST "$BASE/keyboard/type" -H 'Content-Type: application/json' \
  -d '{"text":"hello","selector":"input[name=search]"}'

# Press key with modifiers
curl -s -X POST "$BASE/keyboard/press" -H 'Content-Type: application/json' \
  -d '{"key":"a","modifiers":{"ctrl":true}}'
```

Mouse commands show a visible cursor overlay (white pointer + "AGENT" badge) that animates between positions.

## Admin dashboard

Preact SPA at `/admin/`. Pages:

- **Feedback list** — paginated inbox with filters (type, status, tag, search), batch operations, quick-dispatch to agents. Each item shows a short ID for quick reference.
- **Feedback detail** — full context (console logs, network errors, performance, environment, screenshots with annotations), status/tag editing, agent dispatch with custom instructions
- **Aggregate** — groups feedback by topic using Jaccard similarity, action plan creation per cluster, AI-driven analysis
- **Sessions** — agent session activity log with status filters, terminal output viewer, kill/resume/archive
- **Settings** — global agent configuration, theme (dark/light), keyboard navigation preferences
- **Applications** — register apps with project directories, server URLs, hooks, API key management
- **Live connections** — real-time view of active widget WebSocket sessions

### Sidebar session management

The sidebar has a resizable sessions drawer with search and quick archive. Each session tab shows a status dot that opens a context menu with **Kill**, **Resolve** (marks feedback resolved and closes the session), **Resume**, **Close tab**, and **Archive** actions. Tabs can be numbered — hold `Ctrl+Shift` to see numbers and press `Ctrl+Shift+N` to jump.

### Multi-panel popout system

Session terminals can be popped out of the sidebar into independent floating or docked panels:

- **Drag to pop out** — drag a session tab away from the sidebar to create a floating panel
- **Float / Dock** — toggle between a freely-positioned floating panel and a docked panel pinned to the right edge
- **Drag between panels** — move session tabs between panels, or drag to empty space to split into a new panel
- **Resizable** — all edges are draggable (floating panels: all four sides; docked: top, bottom, left)
- **Persistent layout** — panel positions, sizes, and docked state are saved to localStorage

### Terminal features

Session terminals are full PTY-backed xterm.js instances with:

- **Three view modes** — Terminal (full), Structured (parsed output), Split (55/45 side-by-side)
- **Tmux copy-mode** — drag to select enters copy-mode automatically; vi keybindings (`v` visual select, `Space`/`y` to copy via pbcopy, `Enter` to copy and exit)
- **Right-click context menu** — different options for normal mode (copy, paste, select all, copy tmux attach command) and copy-mode (copy selection, exit copy-mode)
- **Open in terminal** — launches the tmux session in a native Terminal.app window for full local access
- **Auto-resize** — PTY dimensions update on tab switch and panel resize

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+Shift+Space` | Spotlight search (apps, sessions, feedback) |
| `Ctrl+\` | Toggle sidebar |
| `` ` `` | Minimize/restore terminal |
| `g f` | Go to feedback |
| `g a` | Go to aggregate |
| `g s` | Go to sessions |
| `g l` | Go to live connections |
| `g g` | Go to settings |
| `g p` | Go to applications |
| `g t` | Go to agents |
| `Ctrl+Shift+0-9` | Jump to session tab by number |
| `?` | Show shortcut help |

## Agent endpoints

Three execution modes:

| Mode | How it works |
|------|-------------|
| `webhook` | HTTP POST to your URL with feedback payload |
| `headless` | Spawns `claude` CLI as PTY, passes prompt via `-p` flag |
| `interactive` | Spawns `claude` CLI as PTY, sends prompt after shell is ready |

Three permission profiles for PTY modes:

| Profile | Behavior |
|---------|----------|
| `interactive` | Agent waits for user approval on tool use |
| `auto` | No user prompts, agent runs autonomously |
| `yolo` | Skips all permission checks |

Prompt templates use Handlebars-style variables: `{{feedback.title}}`, `{{feedback.description}}`, `{{feedback.consoleLogs}}`, `{{app.name}}`, `{{app.projectDir}}`, `{{session.url}}`, `{{instructions}}`.

## Session management

Agent sessions run as PTY processes managed by the session service. Features:

- **Tmux integration** — if tmux is available, sessions persist across service restarts. On startup, orphaned `pw-*` tmux sessions are automatically recovered. Custom tmux config (`tmux-pw.conf`) provides mouse support, vi copy-mode bindings, and clipboard integration.
- **Output streaming** — WebSocket protocol with sequence numbers for reliable delivery, ACK-based replay for reconnection
- **Output persistence** — logs flushed to SQLite every 10s (last 500KB retained)
- **Kill/resume** — running sessions can be killed or resumed from the admin UI or sidebar context menu
- **Open in terminal** — any running tmux session can be opened in a native Terminal.app window via `POST /api/v1/admin/agent-sessions/:id/open-terminal`
- **Copy tmux attach** — copy the `tmux attach` command to clipboard for manual reattachment
- **Short ID lookup** — sessions and feedback can be referenced by short ID prefix

## Distributed launchers

For running agent sessions on remote machines:

```bash
# On the remote machine
LAUNCHER_NAME=gpu-box MAX_SESSIONS=4 npm run start:launcher
```

The launcher connects via WebSocket to the server, registers its capabilities, and receives `spawn_session` commands. Output streams back through the WebSocket. Multiple launchers can connect; the server selects by availability.

## REST API

### Feedback

```
POST   /api/v1/feedback                    Submit feedback (JSON or multipart with screenshots)
POST   /api/v1/feedback/programmatic       Submit from code (error reports, analytics)
GET    /api/v1/admin/feedback              List (paginated, filterable by type/status/tag/appId/search)
GET    /api/v1/admin/feedback/:id          Get single item with tags and screenshots
PATCH  /api/v1/admin/feedback/:id          Update status, title, description, tags
DELETE /api/v1/admin/feedback/:id          Delete
POST   /api/v1/admin/feedback/batch        Batch operations
GET    /api/v1/admin/feedback/events       SSE stream of new feedback
```

### Agent sessions

```
POST   /api/v1/admin/dispatch              Dispatch feedback to agent (webhook or PTY)
GET    /api/v1/admin/agent-sessions        List sessions (filter by feedbackId)
GET    /api/v1/admin/agent-sessions/:id    Get session with output log
POST   /api/v1/admin/agent-sessions/:id/kill      Kill running session
POST   /api/v1/admin/agent-sessions/:id/resume    Resume session
POST   /api/v1/admin/agent-sessions/:id/archive   Soft delete
POST   /api/v1/admin/agent-sessions/:id/open-terminal  Open in native Terminal.app
DELETE /api/v1/admin/agent-sessions/:id            Permanent delete
```

### Aggregate

```
GET    /api/v1/admin/aggregate             Clustered feedback (filter by appId, minCount)
POST   /api/v1/admin/aggregate/analyze     AI-driven clustering for an app
POST   /api/v1/admin/aggregate/analyze-cluster   AI analysis of specific cluster
GET    /api/v1/admin/aggregate/plans       List action plans
POST   /api/v1/admin/aggregate/plans       Create plan
PATCH  /api/v1/admin/aggregate/plans/:id   Update plan
DELETE /api/v1/admin/aggregate/plans/:id   Delete plan
```

### Virtual mouse and keyboard

```
POST   /api/v1/agent/sessions/:id/mouse/move     Move cursor (shows visible pointer)
POST   /api/v1/agent/sessions/:id/mouse/click    Click at coordinates or selector
POST   /api/v1/agent/sessions/:id/mouse/hover    Hover element (mouseenter + mouseover)
POST   /api/v1/agent/sessions/:id/mouse/drag     Drag from A to B with interpolated steps
POST   /api/v1/agent/sessions/:id/mouse/down     Low-level mousedown
POST   /api/v1/agent/sessions/:id/mouse/up       Low-level mouseup
POST   /api/v1/agent/sessions/:id/keyboard/press  Press key (with optional modifiers)
POST   /api/v1/agent/sessions/:id/keyboard/type   Type text into element
POST   /api/v1/agent/sessions/:id/keyboard/down   Low-level keydown
POST   /api/v1/agent/sessions/:id/keyboard/up     Low-level keyup
```

### Applications and agents

```
GET/POST/PATCH/DELETE  /api/v1/admin/applications
GET/POST/PATCH/DELETE  /api/v1/admin/agents
POST  /api/v1/admin/applications/:id/regenerate-key
```

## Development

```bash
npm run dev              # Start server + session service (watch mode)
npm run build            # Build all packages

# Individual services
cd packages/server
npm run dev:server       # Just the API server
npm run dev:sessions     # Just the session service
npm run dev:launcher     # Just the launcher daemon

# Database
npm run db:generate      # Generate Drizzle migrations
npm run db:migrate       # Apply migrations
```

## Project structure

```
packages/
  widget/       Embeddable JS overlay (web component + session bridge)
  server/       Hono API server, session service, launcher daemon (SQLite/Drizzle)
  admin/        Preact SPA dashboard (Signals + Vite)
  shared/       Shared TypeScript types and Zod schemas
```
