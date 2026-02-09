# Prompt Widget - Agent Integration Guide

## What This Is

Prompt Widget is an embeddable feedback overlay + session bridge that you can add to any webapp. Once embedded, it opens a WebSocket connection back to the Prompt Widget server, which exposes a REST API that agents (like you) can call to interact with the live browser session.

**This gives you a scoped, limited-surface-area alternative to full browser automation.** Instead of controlling the entire browser, you get a curated set of capabilities specific to the webapp.

## Quick Start - Embedding in Your Project

### 1. Add the widget script to your HTML

Add this script tag to any HTML page you want to instrument:

```html
<script
  src="http://PROMPT_WIDGET_SERVER:3001/widget/prompt-widget.js"
  data-endpoint="http://PROMPT_WIDGET_SERVER:3001/api/v1/feedback"
  data-mode="always"
  data-position="bottom-right"
  data-collectors="console,network,performance,environment">
</script>
```

Replace `PROMPT_WIDGET_SERVER` with the actual hostname/IP where the Prompt Widget server is running.

**Configuration attributes:**
- `data-endpoint` - URL to the feedback API endpoint
- `data-mode` - `always` (show button), `admin` (admin-only), `hidden` (programmatic only)
- `data-position` - `bottom-right`, `bottom-left`, `top-right`, `top-left`
- `data-collectors` - Comma-separated: `console`, `network`, `performance`, `environment`

### 2. That's it

Once the script loads, the widget:
- Renders a floating feedback button (unless mode is `hidden`)
- Intercepts console logs and network errors
- Opens a WebSocket connection to the server
- Exposes `window.promptWidget` API for programmatic control

## Agent API Reference

All endpoints are on the Prompt Widget server at `http://PROMPT_WIDGET_SERVER:3001`.

### List Active Sessions

```
GET /api/v1/agent/sessions
```

Returns all currently connected browser sessions:

```json
[
  {
    "sessionId": "abc123",
    "connectedAt": "2026-02-09T20:00:00.000Z",
    "lastActivity": "2026-02-09T20:05:00.000Z",
    "userAgent": "Mozilla/5.0 ...",
    "url": "http://localhost:8080/dashboard",
    "userId": null,
    "viewport": "1920x1080"
  }
]
```

### Get Session Info

```
GET /api/v1/agent/sessions/:sessionId
```

### Get Environment Info

```
GET /api/v1/agent/sessions/:sessionId/environment
```

Returns browser environment details: userAgent, language, platform, screen resolution, viewport, current URL, referrer.

### Get Console Logs

```
GET /api/v1/agent/sessions/:sessionId/console
```

Returns the last 50 console log entries captured from the page:

```json
{
  "logs": [
    { "level": "error", "message": "TypeError: Cannot read property 'foo' of undefined", "timestamp": 1770668706976 },
    { "level": "warn", "message": "Deprecated API usage", "timestamp": 1770668708443 }
  ]
}
```

### Get Network Errors

```
GET /api/v1/agent/sessions/:sessionId/network
```

Returns captured network errors (failed fetch requests):

```json
{
  "errors": [
    { "url": "/api/users", "method": "GET", "status": 500, "statusText": "Internal Server Error", "timestamp": 1770668706976 }
  ]
}
```

### Get Performance Timing

```
GET /api/v1/agent/sessions/:sessionId/performance
```

Returns page load performance metrics: loadTime, domContentLoaded, firstContentfulPaint (all in ms).

### Get DOM Snapshot

```
GET /api/v1/agent/sessions/:sessionId/dom?selector=body
```

Returns DOM info for the selected element including an accessibility tree:

```json
{
  "html": "<body>...</body>",
  "text": "Page text content...",
  "tagName": "BODY",
  "childCount": 5,
  "attributes": {},
  "accessibilityTree": {
    "role": "generic",
    "name": "",
    "tag": "body",
    "children": [
      { "role": "heading", "name": "Dashboard", "tag": "h1" },
      { "role": "navigation", "name": "Main Nav", "tag": "nav", "children": [...] }
    ]
  }
}
```

Use the `selector` query param to target specific elements (CSS selector).

### Execute JavaScript

```
POST /api/v1/agent/sessions/:sessionId/execute
Content-Type: application/json

{ "expression": "return document.querySelectorAll('.error').length" }
```

Runs JavaScript in the page context. The expression is wrapped in an async IIFE, so `await` works. Return values are JSON-serialized.

**Use this for:**
- Reading application state
- Checking element visibility
- Querying DOM programmatically
- Running app-specific diagnostics

### Click Element

```
POST /api/v1/agent/sessions/:sessionId/click
Content-Type: application/json

{ "selector": "button.submit" }
```

Clicks the first element matching the CSS selector. Returns the tag name and text content of what was clicked.

### Type Text

```
POST /api/v1/agent/sessions/:sessionId/type
Content-Type: application/json

{ "selector": "input#search", "text": "search query" }
```

Sets the value of an input/textarea and fires `input` and `change` events. If `selector` is omitted, types into the currently focused element.

### Navigate

```
POST /api/v1/agent/sessions/:sessionId/navigate
Content-Type: application/json

{ "url": "/dashboard/settings" }
```

Navigates the page to the given URL.

### Capture Screenshot

```
POST /api/v1/agent/sessions/:sessionId/screenshot
```

Captures a screenshot of the page and returns it as a base64 data URL. Note: this may timeout on complex pages.

## Feedback API

Beyond live session interaction, the widget also supports feedback submission and management.

### Submit Feedback (from the page)

```js
// Programmatic submission from within the webapp
window.promptWidget.submit({
  type: 'error_report',        // manual, ab_test, analytics, error_report, programmatic
  title: 'Button not working',
  description: 'The save button does nothing when clicked',
  data: { component: 'SaveForm', version: '2.1.0' },
  screenshot: true,            // auto-capture screenshot
  tags: ['bug', 'critical']
});
```

### Submit Feedback (from agent via API)

```
POST /api/v1/feedback/programmatic
Content-Type: application/json

{
  "type": "programmatic",
  "title": "Agent-detected issue",
  "description": "Found potential memory leak in component X",
  "data": { "heapSize": 150000000 },
  "tags": ["agent-detected", "performance"]
}
```

### List Feedback (admin)

```
GET /api/v1/admin/feedback?page=1&limit=20&status=new&type=error_report
```

### Get Feedback Detail

```
GET /api/v1/admin/feedback/:id
```

Returns full feedback with screenshots, console logs, network traces, tags, and dispatch history.

### Update Feedback Status

```
PATCH /api/v1/admin/feedback/:id
Content-Type: application/json

{ "status": "reviewed", "tags": ["triaged", "p1"] }
```

## Typical Agent Workflow

1. **Discover sessions**: `GET /api/v1/agent/sessions` - find active browser sessions
2. **Inspect state**: Use `/console`, `/network`, `/environment`, `/dom` to understand what's happening
3. **Diagnose issues**: Use `/execute` to run diagnostic JS, check app state
4. **Take action**: Use `/click`, `/type`, `/navigate` to interact with the app
5. **Verify**: Check `/console` and `/dom` again to confirm the action worked
6. **Report**: Submit feedback via `/api/v1/feedback/programmatic` with findings

## Admin Console

The admin console is available at `http://PROMPT_WIDGET_SERVER:3001/admin/` (or via Vite dev server during development).

- Default login: `admin` / `admin`
- View all feedback with filters by type, status, tags
- Click into feedback detail to see console logs, network errors, screenshots, performance data
- Change status, add/remove tags
- Dispatch feedback to agent endpoints (configurable webhook targets)

## Architecture Notes

- The widget connects to the server via WebSocket at `ws://SERVER:3001/ws?sessionId=SESSION_ID`
- Session IDs are auto-generated per browser tab (stored in sessionStorage)
- The server acts as a relay: agent REST calls are translated to WS commands sent to the browser
- The browser executes the command and sends the result back via WS
- Request timeout is 15 seconds
- The widget auto-reconnects on WS disconnection
- All data collectors (console, network) are non-destructive interceptors
