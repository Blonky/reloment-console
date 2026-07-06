# Reloment Console

The operator's cockpit for **Reloment** — governed AI texting for regulated
relationship businesses (insurance agencies first). Reloment's agents draft and,
within an explicit autonomy ceiling, send texts on the agency's own number —
renewals, win-backs, speed-to-lead. Every liability-bearing decision is made by
deterministic server code (the send gate), never the model. This console is the
operator's window over that governed runtime: **see** what the agents are doing,
**approve** what needs human eyes, **command** the system in plain language, and
**trust** it — every hold and block is explained in plain English, the kill
switch is one click from everywhere, and the audit trail is visible.

Governance is a feature here, not a footnote. Where a typical SaaS hides its
refusals, this console showcases them: "Sam Ortiz was excluded — opted out" is
the product working, and it gets the same visual dignity as a success.

<!-- SCREENSHOT: add docs/screenshot-home.png (Home) and docs/screenshot-inbox.png
     (Inbox approval cockpit) once Wave 2 ships the two hero screens. -->

## Quickstart

```bash
npm install
npm run dev
```

That's it — with no environment configured, the console boots in **demo mode**
against a deterministic in-memory book for the fictional **Hartley Insurance
Group**. Everything works with zero backend: approve a renewal draft and it
sends; text `STOP` as a customer and the opt-out is recorded so the next approval
is blocked; enroll the win-back playbook and watch it exclude the opted-out and
no-marketing-consent contacts by name. A small **Demo data** pill in the top bar
tells you which client is live.

## Connecting to a platform API

Set two environment variables (e.g. in `.env.local`) and the console swaps the
in-memory client for the real one, hitting the platform's `/api/*` routes:

```bash
VITE_API_URL=https://your-platform-host      # base URL of the platform API
VITE_TENANT_ID=<tenant-uuid>                 # sent as the x-tenant-id header
```

The selection is automatic: `createClient()` returns the HTTP client when
`VITE_API_URL` is set, otherwise the demo client.

## Architecture

Everything renders against a single `DataClient` interface — the console never
fetches directly. Two implementations satisfy it: `DemoClient` (in-memory
Hartley fixtures with working governed mutations) and `HttpClient` (the same
interface over the platform API). Screens depend only on the seam, so the demo
and the live product are the same UI.

```
src/
  main.tsx            entry — mounts <App/>
  App.tsx             router + AppShell
  theme.css           design tokens + base styles (the only global CSS)
  data/               types, DataClient interface + factory, HTTP + Demo clients,
                      the Hartley fixtures, and the useData() hook
  components/         design-system primitives (Card, StatusPill, GateReason, …)
  shell/              AppShell, Sidebar, Topbar
  screens/            home, inbox (hero screens), contacts, campaigns, agents,
                      insights, trust
```

The full design and systems spec — tokens, layout metrics, the DataClient
contract, and the governance components — lives in
[`docs/DESIGN.md`](docs/DESIGN.md). It is the single source of truth; screens are
built to it, not improvised.

## Engineering standards

Vite + React 19 + TypeScript (strict). A deliberately tiny dependency budget:
`react`, `react-dom`, `react-router-dom`, and a self-hosted Inter font — no UI
kit, no icon pack (icons are inline SVGs), no CSS framework. CSS Modules per
component over the `theme.css` tokens. `npm run build` passes clean (tsc + vite);
the demo is deterministic (no randomness — every fixture timestamp is a fixed
offset from a single `DEMO_NOW`).

## License

MIT © 2026 Reloment. See [LICENSE](LICENSE).
