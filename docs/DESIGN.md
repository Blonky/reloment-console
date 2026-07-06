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

## 4. Visual language — "quiet luxury" (v2)

Premium, warm, editorial — the reference class is Sauna's home surface, Wispr
Flow's dashboard, and the calmer end of godly.website: generous whitespace,
one serif display voice, paper warmth, soft floating cards. NOT enterprise-grid
software, NOT purple-SaaS, NOT glassmorphism. Every surface should feel like it
was set by a book designer, then wired by an engineer.

### Tokens (`theme.css`, CSS custom properties)

```
--bg:         #F7F5F0   warm paper app background (whole app sits on this)
--surface:    #FFFFFF   floating cards
--surface-2:  #F0EDE6   inset wells, code, timeline rails
--ink:        #1C1B17   warm near-black
--ink-2:      #6E6B62   secondary text (warm gray)
--line:       rgba(28,27,23,0.08)    default border
--line-strong:rgba(28,27,23,0.16)    inputs, emphasized dividers
--accent:     #0F5847   Reloment green — primary actions, active nav
--accent-ink: #FFFFFF
--accent-soft:#E9F1EC   selected/active backgrounds
--ok: #1D7A3E  --hold: #9A5B12  --block: #A8342A  --info: #2456A6
--imessage: #0B84FE  --rcs: #0E7490  --sms: #6B7280
--radius-sm: 8px  --radius: 14px  --radius-lg: 18px  --radius-pill: 999px
--shadow-soft:  0 1px 2px rgba(28,27,23,0.04), 0 8px 24px rgba(28,27,23,0.05)
--shadow-float: 0 2px 6px rgba(28,27,23,0.05), 0 16px 40px rgba(28,27,23,0.09)
```

Shadows are now allowed — but ONLY these two layered ultra-soft recipes.
Depth = paper vs white + soft shadow, never hard lines everywhere.

### Type — two voices

- **UI voice:** Inter Variable (13px base, 15px reading), self-hosted.
- **Display voice:** **Fraunces Variable** (`@fontsource-variable/fraunces`,
  self-hosted — the ONE new dependency). Used ONLY for: the Home greeting,
  stat-card numbers, the Insights recovered figure, and screen h1s. Settings:
  weight 480–560, optical size high, `letter-spacing:-0.01em`. This serif is
  what separates the product from office software — use it sparingly so it
  stays special.
- Metrics remain `font-variant-numeric: tabular-nums` where digits align in
  columns (tables); big serif stat numbers may use default figures.

### Shell

- **Sidebar (240px):** paper background (no border wall) — a quiet floating
  column. Nav items are full pills (radius-pill): inactive = ink-2 text only;
  hover = rgba ink 4% fill; active = **white pill + shadow-soft + ink text +
  accent icon**. Wordmark in Fraunces. Tenant block bottom = compact white
  pill card.
- **Topbar:** no full-width border; it blends with the paper. Right side:
  "Demo data" pill + status dot pill. Kill-switch band stays a full red band.
- Content `max-width: 1360px`, page padding 40px, 8px grid.

### Screen discipline (hard rules)

- **Every primary screen fits its viewport.** Full-height surfaces (Home idle,
  Inbox, Insights) never scroll the page at desktop sizes; only designated
  inner regions scroll. If a screen needs the page to scroll to reach its
  primary action, the layout is wrong.
- **No decorative chrome.** If a label, kicker, or pane header repeats what
  the topbar or context already says, delete it. Every element on screen must
  earn its place.

### Mobile (≤ 768px)

The console must be *presentable and usable* on a phone (~390px):
- Sidebar disappears; the topbar gains the wordmark + a hamburger that opens a
  slide-in drawer (shadow-float, scrim, Escape/scrim closes) with the same nav
  pills + tenant block.
- Home: greeting clamps smaller, composer full-width, stat cards 2×2,
  Signals stacks. Idle may scroll on phones (the one-viewport rule is
  desktop-only).
- Inbox becomes a single-pane flow: triage list full-width → selecting a
  thread shows the thread full-width with a back chevron in its header;
  Context stays behind the existing sheet toggle.
- Tables scroll horizontally inside their cards; tap targets ≥ 40px.

### Cards & surfaces

- Default card: `--surface`, 1px `--line`, `--radius-lg`, `--shadow-soft`,
  padding 20. Interactive cards hover to `--shadow-float` +
  `translateY(-1px)` (160–200ms ease-out).
- Buttons: primary = accent pill (radius-pill, subtle inner top-light);
  secondary = white pill w/ `--line-strong`; ghost unchanged. Chips/suggestions
  = white pills that lift on hover.
- Inputs: `--line-strong` border, radius, focus = accent ring 2px + soft
  accent glow (`0 0 0 4px var(--accent-soft)`).
- Empty states teach; skeletons shimmer; charts stay hand-rolled SVG.
- Motion: 160–200ms ease-out; transcript cards fade-slide in 6px. Nothing
  bounces.

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

### Home (`/`) — the command surface (Sauna-pattern, v2)

A CENTERED command surface, not a dashboard grid. One scrollable centered
column on paper; the page breathes. Two states:

**Idle state (no turns yet):**
1. Vertical space (~12vh), then the **greeting** — Fraunces, ~42px, centered,
   time-of-day aware and data-led with quiet personality. Compose from the
   pulse, e.g.: morning → "Morning. 2 conversations need your eyes." /
   afternoon-quiet → "All quiet. The fleet is holding 4 conversations." /
   after a win → "Jordan came back. That's $4,120 recovered." Beneath it one
   13px ink-2 subline: "Every command runs the governed send gate — replies
   show exactly who was excluded, and why."
2. The **composer card** (max-width 720px, centered): radius-lg,
   shadow-float, a 15px multi-line input (3 rows), and inside the card's
   footer row: suggestion pills left ("Show renewals", "Enroll win-back",
   "Campaign status", "Brief me on Dana") + a circular accent send button
   right. Focus ring per §4. This card is the centerpiece of the product.
3. The **analytics band** (max-width 980px, centered, ~48px below): four stat
   cards in a row — label (11px uppercase ink-2), **Fraunces ~30px value**,
   12px sub. "Needs your eyes" links to Inbox (hover lift). **Recovered** =
   value in --ok; it is the only colored number. Below the stat row, one wide
   **Signals** card (the 2–3 derived signals with their quiet action links).
4. Footer line, tiny, ink-2, centered: "Deterministic router today — the
   language-model planner ships with the platform connection."

**Active state (≥1 turn):** a NORMAL CHAT INTERFACE — nothing else. The
greeting and the analytics band leave entirely; the transcript owns the column
(user turns right in accent-soft pills, replies as reply cards) and the
composer docks at the bottom. The only non-chat element is a single slim
**pulse strip** above the transcript: one quiet line of inline pills —
"Needs your eyes 4 · Running 6 · Recovered $4,120" — that live-updates after
enroll/kill commands (this preserves the demo moment without dashboard
clutter). aria-live intact.

**The idle→active transition is a feature:** wrap the first-turn state change
in `document.startViewTransition()` when available (with
`view-transition-name: home-composer` on the composer card so it MORPHS from
center-stage to the bottom dock; the greeting fades/rises away). Fallback
browsers get a 200ms CSS ease — never a hard cut.

**Fits one viewport (hard rule):** the idle state must fit within the viewport
with NO page scroll at ≥ 720px viewport height: compact stat cards (value
~24px, padding 14–16), Signals compressed to at most three single-line rows,
greeting size clamps down (`clamp(28px, 3.2vw, 40px)`), and flexible spacers
absorb the slack. Below 720px height, graceful scroll is acceptable.

No topbars-within-cards, no channel chrome ("Command channel" head bar is
gone) — the surface IS the channel. The kill-switch red band stays in the
shell topbar.
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
- **Insights**: ONE viewport, no page scroll at ≥ 800px height — top row is a
  two-card grid (hero recovered number card 1fr | monthly bar chart card 2fr,
  chart ≤ 240px tall), ledger below with its own internal scroll if it must.
  Honesty note: "only causally-attributed outcomes are counted."
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
