# Reloment Console — design & systems spec

The operator console for Reloment: governed AI texting for regulated relationship
businesses (insurance agencies first). This document is the single source of truth
for the console's visual language, information architecture, and frontend systems
design. Screens are built to this spec, not improvised.

> **Naming rule (hard):** the upstream messaging vendor is never named in this
> repository — code, comments, fixtures, or docs. It is "the messaging provider."
> The product brand is **Reloment**. Demo data is the fictional
> **Hartley Insurance Group**.

---

## 1. What the console is

An insurance agency principal runs a book of 2–10k customers. Reloment's agents
draft and (within an autonomy ceiling) send texts on the agency's number —
renewals, win-backs, speed-to-lead. Every liability-bearing decision is made by
deterministic server code (the send gate), never the LLM. The console is the
**operator's cockpit over that governed runtime**:

- **See** what the agents are doing (threads, campaigns, outcomes).
- **Approve** what needs human eyes (the queue is the hero workflow).
- **Command** the system in plain language (the Home command channel).
- **Trust** it: every block/hold is explained in plain English, the kill switch
  is one click from everywhere, and the audit trail is visible.

The UI's first principle: **governance is a feature, not a footnote.** Where a
normal SaaS hides errors, we *showcase* refusals — "Sam Ortiz was excluded:
opted out" is the product working, and the UI treats it with the same visual
dignity as a success state.

## 2. Surfaces (7)

| Route | Surface | Depth (this milestone) |
|---|---|---|
| `/` | **Home** — command channel + pulse | Full |
| `/inbox` | **Inbox** — approval cockpit | Full (hero) |
| `/contacts` | Contacts + memory board | Structured skeleton |
| `/campaigns` | Campaigns (playbook runs) | Structured skeleton |
| `/agents` | Agent roster + autonomy ceilings | Structured skeleton |
| `/insights` | Outcomes / recovered revenue | Structured skeleton |
| `/trust` | Trust & Settings — kill switch, opt-outs, audit | Structured skeleton |

"Structured skeleton" = real layout, real demo data, real design system — but
read-only and shallow. Never a "coming soon" placeholder; every screen must look
like a screenshot from a shipped enterprise product.

## 3. Systems architecture (frontend)

```
src/
  main.tsx            entry — mounts <App/>, picks the data client
  App.tsx             router + AppShell
  theme.css           design tokens + base styles (the only global CSS)
  data/
    types.ts          shared domain types (mirror the platform API shapes)
    client.ts         DataClient interface + createClient() factory
    http.ts           HttpClient — real platform API (VITE_API_URL, x-tenant-id)
    demo.ts           DemoClient — deterministic in-memory Hartley fixtures
    fixtures.ts       the Hartley Insurance demo book (data only)
  components/         design-system primitives (Card, StatusPill, …)
  shell/              AppShell, Sidebar, Topbar
  screens/
    home/             Home screen + its private components
    inbox/            Inbox screen + its private components
    contacts/ campaigns/ agents/ insights/ trust/
```

### The DataClient seam

Everything renders against one interface; the console never fetches directly.

```ts
interface DataClient {
  home(): Promise<HomePulse>
  queue(): Promise<QueueItem[]>
  thread(conversationId: string): Promise<ThreadDetail>
  approve(conversationId: string, messageId: string): Promise<ApproveResult>
  edit(conversationId: string, messageId: string, body: string): Promise<void>
  takeover(conversationId: string): Promise<void>
  simulateInbound(conversationId: string, text: string): Promise<InboundResult>
  queryBook(kind: 'renewals' | 'lapsed'): Promise<BookRow[]>
  enrollPlaybook(playbookKey: string): Promise<EnrollResult>
  campaignStatus(): Promise<CampaignRow[]>
  threadBrief(contactId: string): Promise<ThreadBrief>
  searchConversations(q: string): Promise<SearchHit[]>
  setKillSwitch(on: boolean): Promise<void>
}
```

- **DemoClient** (default): in-memory Hartley fixtures, ~250ms simulated
  latency, and *working mutations* — approving Dana's draft moves it to sent,
  texting STOP as a customer records the opt-out and future approvals of that
  contact return `blocked: opted_out`, enrolling `winback_lapsed` enrolls
  Ava + Noah and excludes Sam (opted out) + Lee (no marketing consent). The
  open-source repo must demo the full governed loop with zero backend.
- **HttpClient**: same interface over the platform API
  (`VITE_API_URL` + `VITE_TENANT_ID` env; sends `x-tenant-id`). Response shapes
  must match the platform's `/api/*` routes exactly.
- Selection: `createClient()` returns HttpClient iff `VITE_API_URL` is set,
  else DemoClient. A small "Demo data" pill in the Topbar shows which is live.

State: React hooks + a tiny `useQuery`-style helper (`useData(fn, deps)`) with
loading/error/refetch. No Redux, no TanStack — the surface is small and the
dependency budget matters in an open-source repo.

### Governance surfaced in the UI (cross-cutting)

- **GateReason**: one component renders every audit reason as a plain-English
  chip with tone (`opted_out` → "Opted out — will never be texted again",
  `quiet_hours` → "Held for quiet hours — sends 8:00 AM their time",
  `no_marketing_consent`, `advice_never_auto` → "Routed to a licensed human", …).
  Blocked ≠ error styling: blocks are calm, factual, slate-toned with a red
  accent; holds are amber; never a scary toast.
- **Kill switch**: omnipresent in the Topbar. Off = quiet dot; on = the entire
  Topbar carries a red "All sending paused" band. Toggling asks for typed
  confirmation ("pause"/"resume").
- **ChannelBadge**: outbound messages show what they were *actually* delivered
  as — iMessage (blue), RCS (teal), SMS (neutral). Degradation is honest.
- **ConsentChips**: every thread header shows consent scopes + quiet-hours
  window for that contact, always visible while composing/approving.

## 4. Visual language

Deliberate, calm, credible — an underwriting desk, not a growth-hacking tool.
No gradients-on-everything, no glassmorphism, no purple-SaaS default.

### Tokens (`theme.css`, CSS custom properties)

```
--bg:        #F6F5F1   warm paper app background
--surface:   #FFFFFF   cards
--surface-2: #EFEDE7   inset wells, code, timeline rails
--ink:       #16191D   primary text
--ink-2:     #5A626B   secondary text
--line:      #E3E0D8   hairline borders (borders > shadows)
--accent:    #0F5847   Reloment green — primary actions, active nav
--accent-ink:#FFFFFF
--accent-soft:#E9F1EE  selected/active backgrounds
--ok:        #1D7A3E   allow / sent / positive
--hold:      #9A5B12   holds, pending, quiet-hours (amber, not alarmist)
--block:     #A8342A   blocks, opt-outs (used sparingly, never shouting)
--info:      #2456A6   informational
--imessage:  #0B84FE   --rcs: #0E7490   --sms: #6B7280
--radius: 10px  --radius-sm: 6px
```

Dark mode: not in this milestone (do not half-ship it).

### Type

- **Inter Variable**, self-hosted via `@fontsource-variable/inter` (no CDN).
- Scale: 13px base UI / 15px reading (thread bubbles) / 20, 28, 40 display.
  Display weights 600–650 with `letter-spacing:-0.02em`.
- **All metrics use `font-variant-numeric: tabular-nums`.** Money is set in the
  display scale — "recovered $4,120" is the product's one metric and gets
  typographic star billing.

### Layout & texture

- Left sidebar 228px (nav + tenant), Topbar 56px, content `max-width: 1360px`,
  page padding 32px, 8px spacing grid throughout.
- Cards: `--surface`, 1px `--line` border, `--radius`, **no drop shadows**
  except overlays/popovers. Depth comes from the paper-vs-white contrast.
- Empty states teach: icon-less, a short sentence of *why* the state is empty
  and the one action that fills it. No cartoon illustrations.
- Loading: skeleton blocks (`--surface-2` shimmer), never spinners for content.
- Motion: 120–160ms ease-out on hover/expand only. Nothing bounces.
- Charts (Insights): hand-rolled inline SVG sparklines/bars in token colors.
  No chart library.

## 5. The two hero screens

### Inbox (`/inbox`) — the approval cockpit

Three-pane: **triage list (300px) | thread (flex) | context rail (280px)**.

- Triage list: each row = avatar initials, name, one-line last message, and a
  **context tag** (StatusPill: "Awaiting approval", "Routed to human",
  "Replied", "Won back"). Sorted needs-you-first. Unread = ink-weight, not
  badges-everywhere.
- Thread: bubbles (inbound left `--surface-2`, outbound right `--accent-soft`
  with ink text), timestamps grouped by day, outbound bubbles carry a
  ChannelBadge + delivery status. System events (holds, blocks, takeovers)
  render as centered hairline timeline entries, not bubbles.
- **DraftCard** (the money component): sits at the thread's foot when a draft
  awaits approval. Shows the draft in an editable well, the playbook it came
  from, and the *pre-flight* consent/quiet-hours chips. Actions:
  **Approve & send** (primary), **Edit** (inline, saves then re-approves),
  **Take over** (ghost — human takes the thread, agent stands down).
  On approve: result renders honestly — sent (with the channel it went as),
  held (GateReason, amber), or blocked (GateReason, calm red).
- Context rail: contact card (LOB, policy status, renewal date, timezone +
  local time), **Memory** (memory atoms as quiet bulleted facts with
  provenance), consent chips, and a demo-only "Simulate customer reply" input
  (with a STOP quick-chip) so the whole governed loop is demoable in-browser.

### Home (`/`) — the command channel

The Manus-style orchestration surface. The command channel is the HERO and owns
the composition; metrics support it from a rail. Layout: a full-height
two-column grid — `minmax(0, 1fr)` for the channel, `300px` for the rail — with
no dead vertical space anywhere:

- **Command channel** (left, full height): head bar, transcript, composer.
  When the transcript is short its content anchors to the BOTTOM (against the
  composer), like every real messaging surface — never a card floating at the
  top of a void.
- **Pulse rail** (right): four compact MetricTiles stacked (fixed ~84px, label
  one line, value on a shared baseline) then the Signals card. **Recovered** is
  the one focal accent (ok-tone value, hairline accent treatment); everything
  else stays quiet. The rail scrolls itself if it must; it never stretches the
  page.
- Suggestion chips live on the composer ONLY — the welcome message is prose
  (plus the "deterministic router today" honesty line), so nothing on screen is
  duplicated.
- **Command channel** (main): a chat column where the operator types intents.
  This milestone ships a **deterministic command router** (no LLM key needed):
  pattern-match intents → DataClient tool calls → rich structured replies
  rendered as cards in the transcript:
  - "show renewals" / "who's lapsing" → queryBook table card
  - "enroll win-back" / "run winback" → EnrollResult card that *narrates
    governance*: enrolled list + excluded list with GateReasons
  - "campaign status" → campaign table card
  - "brief me on dana" → ThreadBrief card (links into Inbox)
  - "search &lt;q&gt;" → conversation hits
  - "pause everything" / "resume" → kill-switch flow (typed confirm)
  - unknown → help card listing what it can do (honest about being
    deterministic; the LLM planner arrives with the platform key)
  Composer has suggestion chips for the above. The transcript is the proof
  that command → governed tool → narrated exclusions works end to end.

## 6. Secondary screens (structured skeletons)

- **Contacts**: table (name, phone, LOB, policy status, renewal, consent
  chips, last activity) + a slide-in detail with the memory board (atoms
  grouped by kind, provenance shown). Read-only.
- **Campaigns**: playbook cards (classification badge: transactional /
  marketing, counsel-signed mark) + per-run stats (enrolled / excluded / sent /
  replied) with the exclusion reasons visible — exclusions are a first-class
  stat, same size as sends.
- **Agents**: roster of line agents — line number, autonomy ceiling
  (draft-only → approved-send → bounded-auto shown as a labeled ladder, current
  rung highlighted), registration status, playbooks attached.
- **Insights**: recovered revenue (big number + hand-rolled monthly bar SVG),
  outcome ledger table (each row: contact, playbook, outcome, $), honesty
  note: "only causally-attributed outcomes are counted."
- **Trust & Settings**: kill switch (big, with typed confirm), opt-out ledger
  (read-only, "never texted again"), audit trail sample (hash-chained rows:
  time, action, reason), data & compliance blurb.

## 7. Engineering standards

- Vite + React 19 + TypeScript strict. Dependencies: `react`, `react-dom`,
  `react-router-dom`, `@fontsource-variable/inter`. **Nothing else** — no UI
  kit, no icon pack (inline 16px SVGs, stroke 1.5, drawn as needed), no CSS
  framework. CSS Modules per component (`*.module.css`) + `theme.css` tokens.
- Every list keyed properly; every async surface has loading + error + empty
  states designed (not left to chance).
- Accessible by construction: real `<button>`/`<nav>`/`<table>`, focus-visible
  rings (2px `--accent`), 4.5:1 contrast on text tokens, `aria-live="polite"`
  on the command transcript and approve results.
- `npm run build` must pass clean (tsc + vite). No `any` in `src/data`.
- Deterministic demo: no `Math.random()`; fixture timestamps are fixed
  relative offsets from a single `DEMO_NOW` constant.
