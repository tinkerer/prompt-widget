# Prompt Widget

Embeddable feedback overlay + agent session bridge for webapps.

## How it works

You drop a `<script>` tag into your webapp. It opens a WebSocket back to the Prompt Widget server. Agents interact with your live app by calling REST endpoints on that server — the server relays commands to the browser over the WebSocket and returns results.

```html
<script
  src="http://your-server:3001/widget/prompt-widget.js"
  data-endpoint="http://your-server:3001/api/v1/feedback"
  data-collectors="console,network,performance,environment">
</script>
```

## Scoped agent access

Browser automation tools like Playwright give agents access to everything — the full DOM, all cookies, every open tab. The agent operates outside your app looking in.

Prompt Widget works the other way. The widget runs inside your app, and you decide what's accessible. The built-in agent API exposes:

- Console logs and network errors the page has seen
- DOM snapshots (with accessibility tree) for specific selectors
- Page environment and performance timing
- Click, type, and navigate actions

That's the baseline. The interesting part is extending it.

## Defining your own hooks

The agent API has an `execute` endpoint that evaluates JS in the page context. This means you can expose application-level operations that don't exist at the DOM level:

```js
// In your app code, expose whatever makes sense for your domain:
window.agent = {
  getCartItems:    () => store.getState().cart.items,
  getFormErrors:   () => Array.from(document.querySelectorAll('[data-error]')).map(el => el.textContent),
  getCurrentRoute: () => router.currentRoute.value,
  getFeatureFlags: () => featureFlags.getAll(),
  getAuthState:    () => ({ loggedIn: !!auth.user, role: auth.user?.role }),
  triggerSync:     () => syncManager.syncNow(),
};
```

An agent calls these through the API:

```
POST /api/v1/agent/sessions/:id/execute
{ "expression": "return window.agent.getCartItems()" }
```

The point is that `getCartItems()` is a concept that exists in your application but not in the browser. Playwright can read the DOM, but it doesn't know what a cart item is. Your hooks bridge that gap — the agent works with your domain model instead of reverse-engineering it from HTML.

You can make hooks as narrow or as broad as you want. An e-commerce app might expose cart and order operations. A dashboard might expose filter state and data queries. A form-heavy app might expose validation state. Nothing is exposed unless you put it on `window.agent`.

## Agent API

See [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md) for the full reference. The short version:

```
GET  /api/v1/agent/sessions                    # list connected browser sessions
GET  /api/v1/agent/sessions/:id/console        # console logs
GET  /api/v1/agent/sessions/:id/network        # network errors
GET  /api/v1/agent/sessions/:id/dom?selector=  # DOM snapshot + a11y tree
POST /api/v1/agent/sessions/:id/execute        # run JS (your hooks live here)
POST /api/v1/agent/sessions/:id/click          # click element by selector
POST /api/v1/agent/sessions/:id/type           # type into input
POST /api/v1/agent/sessions/:id/navigate       # go to URL
```

## Running

```bash
pnpm install
pnpm build
pnpm dev        # starts server on :3001, admin on :5173
```

Admin console at `http://localhost:5173/admin/` (login: admin/admin).
Test page at `http://localhost:3001/test.html`.
