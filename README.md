# Prompt Widget

Embeddable feedback overlay + agent session bridge for webapps.

Drop a `<script>` tag into your app. It opens a WebSocket to the Prompt Widget server. Agents interact with your live browser session through REST endpoints — the server relays commands over the WebSocket and returns results.

## Quick start

```bash
git clone https://github.com/prompt-widget/prompt-widget.git
cd prompt-widget
pnpm install
pnpm build
pnpm dev
```

When the server starts, it prints a prompt you can paste into your running Claude Code session. That prompt points the agent at the getting started guide, which walks through registering your app, creating an agent endpoint, and embedding the widget.

Admin console at `http://localhost:5173/admin/` (login: admin/admin).

## How it works

The widget runs inside your app and you decide what's accessible. The built-in agent API exposes:

- Console logs and network errors
- DOM snapshots with accessibility tree
- Page environment and performance timing
- Click, type, and navigate actions

You can extend it by defining hooks on `window.agent`:

```js
window.agent = {
  getCartItems:    () => store.getState().cart.items,
  getFormErrors:   () => Array.from(document.querySelectorAll('[data-error]')).map(el => el.textContent),
  getCurrentRoute: () => router.currentRoute.value,
};
```

An agent calls these through the API:

```
POST /api/v1/agent/sessions/:id/execute
{ "expression": "return window.agent.getCartItems()" }
```

Nothing is exposed unless you put it on `window.agent`.
