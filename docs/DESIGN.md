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

## 2. Surfaces (6)

| Route | Surface | Depth (this milestone) |
|---|---|---|
| `/` | **Home** — command channel + pulse | Full |
| `/inbox` | **Inbox** — approval cockpit | Full (hero) |
| `/contacts` | Contacts + memory board | Structured skeleton |
| `/agent` | **Agent** — profile + flows + guardrails (Campaigns + Agents merged, r10) | Structured skeleton |
| `/insights` | Outcomes / recovered revenue | Structured skeleton |
| `/trust` | Trust & Settings — kill switch, opt-outs, audit | Structured skeleton |

r10: the old `/campaigns` and `/agents` routes redirect to `/agent`. There is ONE
agent per business (Intercom-Fin shape), so a "roster of agents" no longer exists.

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
  column. Under the wordmark, a **search pill** (magnifier + "Search" + ⌘K
  kbd hint) that opens the command palette. Nav items are full pills
  (radius-pill): inactive = ink-2 text only; hover = rgba ink 4% fill; active
  = **white pill + shadow-soft + ink text + accent icon**. Wordmark in
  Fraunces. Tenant block bottom = compact white pill card.
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

Three-pane: **triage list | thread (flex) | context rail**. The flanking panes
are **fluid** (`minmax(240px, 300px)`, tightening to `minmax(224px, 264/272px)`
≤1280); the thread column is the only `1fr`, so the grid never exceeds 100% and
the thread absorbs every extra/short pixel. Inner paddings tighten ≤1280. The
rail collapses to the sheet <1100px, single-pane flow ≤768px. **No fixed-px
column sum can overflow the viewport — the cockpit never clips at any window
size**, and the SuggestionSlot + Composer are the bottom anchor (the transcript
scrolls; they don't).

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
- Context rail — the **intelligence panel** (r9), in order: (a) **Policy** fact
  line (LOB · status · renewal); (b) **Consent** chips + quiet-hours window;
  (c) **Brief** — the conversation summary folded IN (2 sentences from
  `conversationBrief()`, auto-refreshing on suggestion/message events) with a
  small "Ask" affordance that opens the ConversationBrief **Inspector** for Q&A +
  key moments (the sparkle button moved here from the thread header);
  (d) **Memory** (atoms as quiet bullets, capped at 3 behind a "+N more" toggle
  so the rail fits unscrolled at 1512×860); (e) **Agent asks** — the contact-
  scoped asks for this contact from `agentAsks()` (ask + one-line why, quiet
  accent left border); (f) a **"Steer the agent"** block (r10, darker surface +
  dashed hairline top) — four ghost goal chips (Book a time / Take a payment /
  Collect info / Request a doc) + an optional note that appears once a goal is
  active. Selecting a goal calls `steer()`; the active chip gets the accent
  treatment; the suggestion slot morphs toward the goal. Hidden when opted out.
  The demo affordances (play-the-customer, STOP/START, missed call) moved OUT of
  the rail to the topbar **"Demo controls"** popover (r10).
- **Composer ＋ menu** (r9): a small circular ＋ inside-left the composer opens an
  upward popover (hairline card, shadow-float) — "Request a document ▸" (dec page
  / driver's license / damage photos), "Send booking link", "Send payment link" —
  each routing through `sendLink()`. Escape / outside-click closes; focus returns
  to the input. Link-part outbounds render in the bubble as a **link-preview
  card** (title + domain + link glyph), mirroring the provider's rich-link
  unfurl. Blocked sends surface the GateReason honestly.

#### Live thread (v3)

The thread is driven by a **live event feed** on the DataClient, modeled on the
provider's real-time delivery: `subscribe(handler) → unsubscribe`. The feed
carries **notifications, not state** — every payload is also written to the
store, so `thread()` / `queue()` reads stay the single source of truth.

- **Event contract** (`FeedEvent`): `typing` (who: customer|agent,
  state: typing|stopped), `message.received`, `draft.created`, `message.sent`,
  `consent.changed`. HttpClient maps the provider's SSE stream
  (`GET /api/v1/events/stream`, reconnect via `?since=<iso>`) — it connects an
  `EventSource` lazily on first subscribe, maps `message.received` through, and
  degrades to a silent no-op when no backend is present, closing when the last
  subscriber leaves. DemoClient is an in-memory emitter.
- **Typing-before-send choreography** (matches the provider's typing-indicator
  guidance — "a UI signal before an agent or automation sends a follow-up"): on
  a simulated inbound the customer types (~700ms) then the message lands; for a
  normal message on an agent-controlled, not-opted-out thread the agent then
  types (~900ms) and a **held draft** appears (~1400ms). `simulateInbound`
  returns an ack immediately; the timers carry the payloads.
- **Opt-out lifecycle** (Reloment's layer — the provider has no STOP/START
  handling): a STOP keyword records **exactly one** system timeline entry
  (`opted_out`) and one `consent.changed` per state change; a repeated STOP
  records only the inbound bubble (no duplicate entry, no event). Only the
  **customer** can opt back in via a START keyword, which restores
  **transactional consent only** — marketing stays revoked (resuming does not
  re-grant marketing express consent) — writing one `opted_back_in` entry and a
  `consent.changed`. `message.sent` fires on approve so an open thread updates
  live.
- **Conversation brief** (`conversationBrief` / `askThread`): a brief is a 2–3
  sentence recap composed deterministically from real thread state (contact +
  product line, last inbound, current gate/consent state, what the agent did),
  a list of timeline `moments`, and three canned `askSuggestions`. `askThread`
  keyword-matches the question (summary / why-held / what-they-asked / next-step)
  and answers **only** from the thread's real messages, consent, and gate
  decisions — never invented facts.

#### Messages-first thread (v4)

The thread stops being an approval cockpit and becomes a **messages-first
surface**. We are on the **agency's side** of the conversation: a normal
composer you type into and send as the business, immediately. The agent's
next-best move rides **above** the composer as a suggestion, and a
per-conversation **Agent ON/OFF** toggle decides whether the agent acts on its
own. Takeover-as-a-separate-state is gone — it collapses into the toggle.

- **Composer (always available).** You just type and send; the message goes out
  as the business right away. The **only lock is opted-out** — nothing else
  disables the composer. Every send still runs the **send gate** on every
  keystroke-free submit (kill switch → opt-out → consent → quiet hours), exactly
  like `approve()`; a block surfaces the GateReason honestly. `sendManual` has
  **no** human-controller requirement anymore. A human send **clears any held
  draft** on that conversation (the human answered instead — the stale draft is
  removed so no orphan "Held" state lingers).
- **Suggestion slot** (`suggestion(conversationId) → Suggestion | null`). The
  agent's next-best message, shown above the composer and **regenerated after
  every turn**. Two shapes and one silence:
  - **Held** (`held: true`, `draftId`): a gate-held playbook draft awaiting
    approval — `approve(draftId)` sends it. Carries the playbook label and a
    data-drawn rationale.
  - **Assistive** (`held: false`): a purely helpful draft the human may send,
    edit, or ignore. It changes nothing until you act.
  - **null = silence is the best action.** Returned honestly when a nudge would
    be pushy: the contact is opted out, just declined, just got a closing
    message (won-back — leave them alone), or our last outbound is unanswered
    and still fresh (< 1h). At least one fixture (**Jordan**, a just-confirmed
    win-back) resolves to null by design.
  - **Rationale requirement.** `rationale` (1–3 short reasons) **must cite the
    real data used** — renewal proximity, memory atoms (teenage driver, prefers
    texts after 6pm, sore about the rate increase), LOB gap, policy status.
    Never invented. The body sounds like the Hartley drafts: short, human, one
    question max, names Tom where natural.
  - **Follow-up ladder (never re-pitch what we already sent).** The suggestion
    engine evolves off the WHOLE conversation, including the agent's *own*
    unanswered outbound (human sends count as the agent's too — see the toggle).
    Rules:
    - **HARD anti-repeat.** Never return a body that already appears —
      normalized (trim + lowercase) — among the thread's own outbound sends.
      Enforced by a **final check**, not just by construction: even a
      correctly-built base message is dropped to `null` if it duplicates a send.
      This kills the round-9 bug where approving a renewal draft re-suggested the
      identical renewal text a third time.
    - **Rung 1** — one unanswered outbound, **aged ≥ 1h** by the demo clock: a
      **shorter, different-angle** nudge grounded in memory atoms (Dana → the
      teenage-driver review agenda / an evening slot because "prefers texts after
      6pm"), never the original pitch. `rationale[0]` names the ladder state
      ("No reply to yesterday's text — trying a different angle").
    - **Rung 2** — two unanswered outbounds: **`null` (wait)**. A third text is
      what a good producer would not send.
    - An unanswered outbound **< 1h** old: `null` (still fresh — unchanged rule).
    - **A customer reply resets the ladder** to rung 0 (they hold the ball; the
      base builder runs again).
- **Agent toggle** (`setAgentEnabled(conversationId, enabled)`; `FeedEvent`
  `agent.toggled`). A day/night switch per conversation. **A human message never
  disables the agent** — it's just another outbound the agent knows about and
  treats as if it had sent it (its context includes human turns as its own).
  Only the toggle changes agent state. `agent_enabled` is the source of truth;
  `controller` ('agent' | 'human') is kept mirrored for back-compat. `takeover()`
  is now a thin alias for `setAgentEnabled(false)`.
- **Regeneration** (`FeedEvent` `suggestion.updated`). Fires after **any**
  message lands on a conversation — inbound (`message.received`), an agent draft
  created, `message.sent` (approve / auto-ack), a manual send, opt-out/opt-in
  changes, and the agent toggle. The UI refetches `suggestion()` on it. A newly
  created held draft **replaces** any prior suggestion.
- **Autonomy matrix.** Auto-ack for the **missed-call inquiry basis** (a bounded
  acknowledgement auto-sends within the ceiling, still gated). Approval-held for
  **playbook sends** (the agent proposes; the human approves). **Assistive-only**
  when the toggle is OFF — no agent typing or drafts on inbound, but
  `suggestion.updated` still fires so the human always has a fresh
  `held: false` suggestion to lean on.
- **Steering** (`steer(conversationId, goal, note?)`; `SteerGoal =
  'book_time' | 'take_payment' | 'collect_info' | 'request_document'`; `null`
  clears; `FeedEvent` `steer.changed`). A **STEER** block on the rail lets the
  producer point the agent at a concrete goal on a live thread. The suggestion
  engine **incorporates it naturally** — never a canned line:
  - **book_time** → works a concrete time offer in (uses `bookingConnection()` +
    memory, e.g. Dana's "prefers texts after 6pm" → an after-6 slot).
  - **take_payment** → a natural payment nudge tied to real context (a renewal
    that's due) — one sentence + the ask, never pushy.
  - **collect_info** → asks for the fact the agent actually lacks (the same gap
    `agentAsks()` surfaces — e.g. an Auto+Home renewal needs the dec page).
  - **request_document** → mirrors the document ask (a phone pic is fine).
  A free-text **note** ("mention the bundle discount") is woven in as a clause.
  Steering **respects the ladder** (still never repeats a sent body; rung-2 "wait"
  still wins) **except a fresh steer resets one rung** — a one-time credit,
  because the human explicitly asked for an action; re-armed on each new steer.
  `rationale` gains a `"Steered: book a time"` entry. Steered + opted-out is still
  `null` (the gate would refuse every outbound). Emits `steer.changed` +
  `suggestion.updated`.

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
3. The **"Today" briefing band** (r9; max-width 980px, centered, ~14–28px
   below): ONE cohesive card from `homeBriefing()` — a 3-column grid (1fr each,
   stacks ≤1100px): **Needs you** (approvals + asks, each a link with a Fraunces
   count), **Overnight** (plain-English one-liners of what the agent did, with
   the running-count + Recovered figure folded in compactly), **Worth a call**
   (top-3 call-list names + one reason each, linking to /contacts). Under it a
   slim strip of the top **agent asks** (tenant + contact mixed, max 2). The
   pulse numbers live INSIDE the columns — **no separate stat band**. Every field
   is derived from existing session state (no new hardcoded stats). At 720–860px
   height the greeting/band spacing tightens so the surface holds one viewport.
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

**Artifacts, not dumps (v3):** a command's reply in the transcript is at most
three things — (1) one sentence of narration, (2) a **gate disclosure**: a
quiet collapsed line "Ran the send gate · N checks · <duration>" that expands
to the actual deterministic checks executed in order (kill switch → opt-out →
consent → registration → quiet hours → …) with a pass/blocked dot per check,
and (3) an **artifact card**: icon + title + count + one-line summary + "View
table →". Clicking the artifact opens the **inspector** — a right side panel
(desktop: 520px slide-in, shadow-float, Escape/scrim closes; phone:
full-width sheet) that renders the full table/detail. Full tables NEVER
render inline in the transcript. Exception: the enroll result keeps its
enrolled/excluded GateReason rows inline (the exclusions ARE the product
moment) but capped and compact, with the full run in the inspector.
The inspector is a shared shell primitive — Contacts' detail panel and the
Inbox context sheet converge on it.
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
  chips, last activity) + a slide-in detail (the shared inspector) with the
  memory board (atoms grouped by kind, provenance shown) AND a **Data
  sources** section — the book-enrichment story: one row per source (AMS
  sync, conversations, carrier lookup) with what it contributes and when it
  last updated. First-party enrichment only; cold-lead enrichment is
  deliberately out of scope (the consent gate is the product).
- **Agent** (r10 — Campaigns + Agents merged into one surface): there is **ONE
  agent per business** that switches roles across flows (Intercom-Fin shape), not
  a roster of separate bots. Three parts, all warm and plain-language:
  - **Profile** (`agentProfile(): Promise<AgentProfile>` —
    `{ name; line; trainedOn; traits[]; example{ generic; tuned }; guardrails[] }`).
    The agent's identity card: a simple human name ("Hartley concierge"), the line
    it sends on, the voice it was trained to (from `toneProfile()`), a
    generic-vs-tuned example, and the fixed **guardrails** it operates under
    (advice → licensed human; consent gate refuses everything else; quiet hours in
    the customer's timezone; STOP always sticks). Composed from `TONE_PROFILE` +
    `LINE_E164` — no new hardcoded facts.
  - **Flows** (`playbookFlows(): Promise<PlaybookFlow[]>` —
    `{ key; name; enabled; when; who; what; autonomy; autonomyLabel; stats }`).
    Each playbook reads as a plain-language flow: **when** it fires ("A policy is
    30 days from renewal", "Someone calls and we miss it"), **who** it reaches,
    **what** the message does (the approach, not the raw template), and its
    **autonomy** in HubSpot-Breeze plain language — **"Review before sending"**
    (draft-for-approval) vs **"Sends automatically (still gated)"** (the
    missed-call inquiry ack). Each flow has a session on/off toggle
    (`setPlaybookEnabled(key, enabled)`; default all on; `FeedEvent`
    `playbook.toggled`): a **disabled** flow stops producing drafts/acks in the
    inbound + missed-call choreography and drops out of the home briefing. `stats`
    (enrolled / sent / replied / heldBack) derive from the SAME
    enrollment/campaign store as `campaignStatus()` — single source of truth (the
    Home artifact still reads `campaignStatus()`).
  - **Guardrails**: the fixed rules above, shown as a first-class list — the point
    of the product is what the agent will **not** do without a human.

  **Canonical agent voice (r10).** All agent-**authored** copy — playbook
  templates, held drafts, suggestion bodies (base + ladder + steered), the
  missed-call auto-ack, document asks, link-send sentences, the tuned tone
  example — is **warm business-casual**: contractions, first names, one thought
  per text, zero corporate stiffness. Hard limits: **≤ 2 sentences**, **one
  question max**, **no emojis** in agent sends. (The refusal/system copy — opt-out
  banners, GateReason strings, centered timeline entries — is **UI**, not the
  agent's voice, and is exempt.)
- **Insights**: ONE viewport, no page scroll at ≥ 800px height — top row is a
  two-card grid (hero recovered number card 1fr | monthly bar chart card 2fr,
  chart ≤ 240px tall), ledger below with its own internal scroll if it must.
  Honesty note: "only causally-attributed outcomes are counted."
- **Trust & Settings**: kill switch (big, with typed confirm), opt-out ledger
  (read-only, "never texted again"), audit trail sample (hash-chained rows:
  time, action, reason), data & compliance blurb.

## 7. Operations features (round 7)

Producer-facing operations layered onto the governed runtime. Every send path —
automated or human — runs the same deterministic send gate; fail-closed is the
product. New `DataClient` methods (DemoClient chorographs them in-memory;
HttpClient maps provider-style endpoints and degrades gracefully):

- **Missed-call text-back** — `simulateMissedCall(): Promise<{ conversationId }>`.
  The line is messaging-only (no voice), so a missed call arrives via Reloment's
  voice-capture forward, which emits a `call.missed` FeedEvent
  (`{ conversationId, callerName, e164 }`). Choreography: at **t=0** the event
  mints the conversation with a system entry (status `missed_call`, "Missed call
  · forwarded to text-back") and records consent on **inquiry basis**
  (`inbound_call`) at call time — so `listConversations()` includes it
  immediately; at **~1200ms** the agent types; at **~2600ms** the acknowledgement
  **auto-sends** (status `sent`) — "Sorry we missed your call — this is Hartley
  Insurance's text line. How can we help?". It auto-sends (no approval) because
  the missed-call playbook's autonomy ceiling permits an inquiry-basis
  acknowledgement — **but it still passes the gate**: if the caller is on the
  opt-out list, no text is sent.
- **Manual follow-up** — `sendManual(conversationId, body): Promise<{ ok; blockedReason? }>`.
  For human-controlled threads. Runs the **same gate semantics**: blocked returns
  `{ ok:false, blockedReason:'opted_out' }` (fail-closed); a clear gate appends
  an outbound `sent` message and emits `message.sent`. Manual sends are gated too.
- **Call list** — `callList(): Promise<CallListRow[]>`. A deterministic producer
  worklist ranked over the book by renewal proximity, engagement (a recent
  inbound), policy status (lapsed = reactivation), and LOB gap (auto-only =
  bundle candidate), with plain-English `reasons`. Contacts with `consentState`
  `opted_out` or `none` **still appear**, but their `suggestedAction` is always
  **"Call"**, never **"Text"** — texting an unconsented lead is exactly what the
  gate refuses; a phone call is fine. 5–7 rows.
- **Documents** — `requestDocument(conversationId, docType): Promise<void>`. A
  gated outbound ("Could you text us a photo of your {docType}? A picture is
  fine.") — **silently a no-op if opted out** — then at **~2800ms** the customer
  replies with an inbound carrying a **media part**
  (`{ type:'media', filename, mime_type, size_bytes }`, mirroring the provider's
  media parts on `ThreadMessage.parts`). Offered doc types: declarations page,
  driver's license, photos of damage.
- **Link sends** — `sendLink(conversationId, kind: 'booking' | 'payment' | 'document_request', docType?): Promise<{ ok; blockedReason? }>`.
  The business sends a rich link the provider **natively unfurls** into a preview
  card, so the outbound carries a `LinkPart` (`{ type:'link', url, title, domain }`)
  on `ThreadMessage.parts` next to one short human sentence. Gated exactly like
  `sendManual` (fail-closed: kill switch / opt-out / consent). **booking** →
  `hartley.reloment.link/book`, title "Book with Tom Hartley — Renewal reviews"
  (from `bookingConnection()`); **payment** → `hartley.reloment.link/pay`, title
  "Pay your premium — Hartley Insurance" (demo domain — **no real payment
  processor is named**); **document_request** delegates to `requestDocument`
  (its own media-reply choreography). Emits `message.sent` + `suggestion.updated`.
- **Agent asks** — `agentAsks(): Promise<AgentAsk[]>`
  (`{ id, scope:'contact'|'tenant', contactId?, contactName?, ask, why }`). The
  agent **reaches back to the business** with 3–5 deterministic asks recomputed
  cheaply on read from the same fixture + session state (no new events): contact-
  scoped ("Ask Dana for the home declarations page" — the bundle quote needs it;
  "Confirm Marcus's coverage-limit answer with a licensed producer" — routed to a
  human, waiting; "Have a producer call Ray back" — no text consent on file) and
  tenant-scoped ("Add evening booking slots" — N contacts prefer texts after 6pm;
  Voice-training when that connection is `action_needed`). Order is stable
  (contact asks first, then tenant) so the briefing can take the top N. Never
  invented — every `why` is grounded in real state.
- **Home briefing** — `homeBriefing(): Promise<HomeBriefing>`
  (`{ needsYou: { label; count; href }[]; overnight: string[]; callOut: { name; reason }[]; asks: AgentAsk[] }`).
  Home becomes a **daily briefing**, composed from existing state — single
  sources of truth, **no new hardcoded stats**: `needsYou` = approvals waiting
  (→ `/inbox`, same count as the queue) + asks count; `overnight` = plain-English
  one-liners of what the agent did (sent / held / blocked counts + missed calls
  answered, counted from the audit log); `callOut` = the top 3 of `callList()`
  each with one reason; `asks` = the top 3 of `agentAsks()`.
- **Voice/tone profile** — `toneProfile(): Promise<ToneProfile>`. How the agents
  were tuned to the agency's voice: `trainedOn`, `traits`, and a generic-vs-tuned
  renewal-text `example`.
- **Booking** — `bookingConnection(): Promise<{ provider; status; calendar }>`.
  The scheduling connection drafts already propose times against (Calendly, "Tom
  Hartley — Renewal reviews").
- **Playbooks** — two new fixtures alongside win-back: **`missed_call`**
  (trigger `call.missed`, autonomy `auto_send_ack`, inquiry-basis acknowledgement)
  and **`bundle_upsell`** (auto→auto+home cross-sell, draft-for-approval). Win-back
  reactivates dead leads whose consent is still valid.

**Compliance stances (the point):** missed-call text = inquiry consent basis,
still gated; manual sends gated; the call list never suggests texting an
unconsented lead (only calling); documents flow in as provider media parts.

## 8. Engineering standards

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
