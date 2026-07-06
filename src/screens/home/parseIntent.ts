// parseIntent — the deterministic command router for the Home command channel.
//
// A pure function: (input: string) => Intent. No side effects, no client calls,
// no React. It classifies a plain-language line into one of a fixed set of
// intents, then the transcript layer dispatches the matching DataClient tool.
//
// Design intent (DESIGN.md §5): this milestone ships a *deterministic* router
// so the whole governed loop demos with zero LLM key. Patterns are
// case-insensitive, synonym-tolerant, and exhaustive over the shipped verbs.
// Everything unrecognised falls through to `help` — honest about the boundary.

// ── Intent shapes ─────────────────────────────────────────────────────────────
export type Intent =
  | { kind: 'renewals' } // client.queryBook('renewals')
  | { kind: 'lapsed' } // client.queryBook('lapsed')
  | { kind: 'enroll_winback' } // client.enrollPlaybook('winback_lapsed')
  | { kind: 'campaign_status' } // client.campaignStatus()
  | { kind: 'brief'; name: string } // client.threadBrief(resolve(name))
  | { kind: 'search'; query: string } // client.searchConversations(query)
  | { kind: 'call_list' } // client.callList() — the producer worklist
  | { kind: 'missed_call' } // client.simulateMissedCall() — text-back demo
  | { kind: 'research'; name: string } // client.researchContact(name) — enrichment waterfall
  | { kind: 'navigate'; query: string } // client.resolveNavigate(query) — "take me to…"
  | { kind: 'pause' } // kill switch → on (typed confirm)
  | { kind: 'resume' } // kill switch → off (typed confirm)
  | { kind: 'help' }; // honest capabilities card

// Normalise: lowercase, collapse whitespace, strip trailing punctuation/politeness.
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A tiny matcher: does any of the given regexes hit the normalised text?
function any(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

// ── Pattern banks (kept named so they can be listed in the help card too) ─────
// Order matters: more specific intents are tested before broad ones.

const RESUME_PATTERNS: RegExp[] = [
  /\bresume\b/,
  /\bun[- ]?pause\b/,
  /\bunpause\b/,
  /\bturn (sending )?back on\b/,
  /\bstart (sending|sends) again\b/,
  /\bre[- ]?enable (sending|sends)\b/,
  /\ball clear\b/,
  /\blift the (kill switch|pause|freeze)\b/,
];

const PAUSE_PATTERNS: RegExp[] = [
  /\bpause (everything|all|sending|sends|the fleet|all sending)\b/,
  /\bpause\b/,
  /\bstop (all|everything|sending|sends|all sending|the fleet)\b/,
  /\bhalt (all|everything|sending|sends)?\b/,
  /\bkill switch\b/,
  /\bfreeze (sending|sends|everything|all)\b/,
  /\bhold all (sends|sending)\b/,
  /\bemergency stop\b/,
];

// "who should we call" / "call list" / "who to call today" / "prioritize calls"
const CALL_LIST_PATTERNS: RegExp[] = [
  /\bcall list\b/,
  /\bwho (should|do) (we|i) call\b/,
  /\bwho to call\b/,
  /\bwho('?s| is) worth (a )?call\b/,
  /\b(prioriti[sz]e|rank) (my )?(calls?|dials?|book|outreach)\b/,
  /\bwho should i (be )?(dial|call)/,
  /\b(build|make|show) (me )?(a |the )?(call|dial) list\b/,
];

// "simulate a missed call" / "missed call" — the text-back demo affordance.
const MISSED_CALL_PATTERNS: RegExp[] = [
  /\bmissed calls?\b/,
  /\b(simulate|trigger|test|demo) (a )?(missed )?call/,
  /\bcall (came in|dropped|went unanswered)\b/,
  /\btext[- ]?back\b/,
];

const ENROLL_WINBACK_PATTERNS: RegExp[] = [
  /\benroll\b.*\bwin[- ]?back\b/,
  /\bwin[- ]?back\b.*\benroll\b/,
  /\brun\b.*\bwin[- ]?back\b/,
  /\bstart\b.*\bwin[- ]?back\b/,
  /\blaunch\b.*\bwin[- ]?back\b/,
  /\bkick off\b.*\bwin[- ]?back\b/,
  /\bwin[- ]?back\b.*\b(campaign|playbook|run)\b/,
  /\bwinback\b/,
  /\benroll\b.*\blapsed\b/,
  /\bre[- ]?engage\b.*\blapsed\b/,
];

const CAMPAIGN_STATUS_PATTERNS: RegExp[] = [
  /\bcampaign(s)? status\b/,
  /\bstatus of (the )?campaign(s)?\b/,
  /\bhow are (the )?campaigns\b/,
  /\bhow('?s| is) (the )?campaign(s)?\b/,
  /\b(playbook|campaign)(s)? (doing|running|progress)\b/,
  /\bshow (me )?(the )?campaign(s)?\b/,
  /\bcampaign(s)? (report|overview|summary)\b/,
];

const RENEWALS_PATTERNS: RegExp[] = [
  /\b(show|list|who('?s| is| are)|see|pull up)\b.*\brenewal(s)?\b/,
  /\brenewal(s)?\b.*\b(coming up|due|next|30|thirty|this month|soon)\b/,
  /\bup for renewal\b/,
  /\bwho('?s| is| are)\b.*\b(renew|renewing|up for renewal)\b/,
  /\brenewals?\b/,
  /\brenewing\b/,
];

const LAPSED_PATTERNS: RegExp[] = [
  /\b(show|list|who('?s| is| are)|see|pull up)\b.*\blaps(ed|ing)\b/,
  /\bwho('?s| is| are)\b.*\blaps(ed|ing)\b/,
  /\blapsed (quotes?|policies|customers?|book)\b/,
  /\blaps(ed|ing)\b/,
  /\bdropped off\b/,
  /\bwent cold\b/,
];

// "brief me on dana" / "what's the story with dana" / "tell me about dana"
const BRIEF_PATTERNS: RegExp[] = [
  /^brief me on (.+)$/,
  /^brief (.+)$/,
  /^(what'?s|whats) the story (with|on|about) (.+)$/,
  /^tell me about (.+)$/,
  /^(who|what) is (.+)$/,
  /^catch me up on (.+)$/,
  /^give me (?:the )?(?:rundown|background) on (.+)$/,
  /^background on (.+)$/,
];

// "research Ray" / "enrich Dana Whitfield" / "look up Marcus" / "run enrichment on x"
// The enrichment waterfall over a named contact (first-party-only).
const RESEARCH_PATTERNS: RegExp[] = [
  /^research (?:on |contact )?(.+)$/,
  /^enrich (?:contact )?(.+)$/,
  /^(?:run|do) (?:an? )?(?:enrichment|research|waterfall) (?:on|for) (.+)$/,
  /^look up (.+)$/,
  /^dig up (?:everything |what we have )?(?:on|about) (.+)$/,
  /^what do we (?:know|have) (?:on|about) (.+)$/,
];

// "take me to Dana" / "open inbox" / "go to settings" / "show me the agent flows"
// Resolved by resolveNavigate — section words win over a stray name match.
const NAVIGATE_PATTERNS: RegExp[] = [
  /^take me to (?:the )?(.+)$/,
  /^(?:go|jump|navigate) to (?:the )?(.+)$/,
  /^open (?:the )?(.+)$/,
  /^show me (?:the )?(.+)$/,
  /^bring me to (?:the )?(.+)$/,
];

// "search x" / "find conversations about x" / "look for x"
const SEARCH_PATTERNS: RegExp[] = [
  /^search (?:for )?(.+)$/,
  /^find (?:conversations?|threads?|messages?|chats?) (?:about|mentioning|for|with) (.+)$/,
  /^find (.+)$/,
  /^look (?:for|up) (.+)$/,
  /^who (?:mentioned|said|talked about) (.+)$/,
  /^(?:any )?(?:conversations?|threads?) (?:about|mentioning) (.+)$/,
];

const HELP_PATTERNS: RegExp[] = [
  /^help$/,
  /^\?$/,
  /^what can (you|i) do\b/,
  /^commands?$/,
  /^how does this work\b/,
];

// Extract the first non-empty capture group from the first matching pattern.
function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      for (let i = 1; i < m.length; i += 1) {
        const group = m[i]?.trim();
        // Skip verb-fragment groups the alternation may have captured first.
        if (group && !/^(with|on|about|for)$/.test(group)) return group;
      }
    }
  }
  return null;
}

// A navigate target that is really a bare book-read command — "show renewals",
// "open campaign status" — should stay its own read, not a page navigation.
// Section words (inbox, agent, flows, insights, settings, contacts, book) are
// deliberately NOT here so "open inbox" / "show me the flows" still navigate.
function isBookReadNoun(target: string): boolean {
  return /^(the )?(renewals?|laps(ed|ing)|campaign(s)?( status)?|win[- ]?back|call list)\b/.test(
    target.trim(),
  );
}

export function parseIntent(input: string): Intent {
  const text = normalize(input);
  if (text.length === 0) return { kind: 'help' };

  if (any(text, HELP_PATTERNS)) return { kind: 'help' };

  // Kill-switch verbs first: "resume" before "pause" (resume also contains no
  // pause token, but stop-family words must not shadow an explicit resume).
  if (any(text, RESUME_PATTERNS)) return { kind: 'resume' };
  if (any(text, PAUSE_PATTERNS)) return { kind: 'pause' };

  // Operations verbs before the generic book reads: the missed-call demo and
  // the producer call list both carry "call" tokens the renewal/lapsed banks
  // must not shadow. Missed-call first (more specific), then the call list.
  if (any(text, MISSED_CALL_PATTERNS)) return { kind: 'missed_call' };
  if (any(text, CALL_LIST_PATTERNS)) return { kind: 'call_list' };

  // Enroll before generic lapsed/renewal reads (it references the same nouns).
  if (any(text, ENROLL_WINBACK_PATTERNS)) return { kind: 'enroll_winback' };

  if (any(text, CAMPAIGN_STATUS_PATTERNS)) return { kind: 'campaign_status' };

  // Brief/research carry an argument — test them before the bare noun reads so a
  // "brief me on dana" line isn't swallowed by a stray "renewal" token.
  const briefName = firstCapture(text, BRIEF_PATTERNS);
  if (briefName) return { kind: 'brief', name: briefName };

  // Research/enrichment ("research Ray", "enrich Dana", "look up Marcus") — a
  // named contact waterfall. Before search so "look up X" runs enrichment, not
  // a text search; the UI honestly reports an unknown name.
  const researchName = firstCapture(text, RESEARCH_PATTERNS);
  if (researchName) return { kind: 'research', name: researchName };

  // Navigation ("take me to Dana", "open inbox", "show me the agent flows"). A
  // navigate verb wins UNLESS its target is a bare book-read noun — "show
  // renewals" / "open campaign status" stay their own read commands. The client
  // resolves the target (section word or contact); an unresolved one falls to
  // the honest "nowhere to open" reply.
  const navTarget = firstCapture(text, NAVIGATE_PATTERNS);
  if (navTarget && !isBookReadNoun(navTarget)) {
    return { kind: 'navigate', query: navTarget };
  }

  const searchQuery = firstCapture(text, SEARCH_PATTERNS);
  if (searchQuery) return { kind: 'search', query: searchQuery };

  // Lapsed before renewals: "who's lapsing" must not match a loose renewal verb.
  if (any(text, LAPSED_PATTERNS)) return { kind: 'lapsed' };
  if (any(text, RENEWALS_PATTERNS)) return { kind: 'renewals' };

  return { kind: 'help' };
}

// The command catalogue — shared by the help card and the composer chips so
// the two never drift. Each entry documents one shipped intent.
export interface CommandDoc {
  label: string; // chip / list label
  example: string; // an example phrasing the user can click to run
  blurb: string; // one plain line describing what it does
}

export const COMMAND_CATALOGUE: CommandDoc[] = [
  {
    label: 'Show renewals',
    example: 'Show renewals',
    blurb: 'Who’s up for renewal in the next 30 days.',
  },
  {
    label: 'Who’s lapsing',
    example: 'Who’s lapsing',
    blurb: 'Lapsed quotes worth a win-back.',
  },
  {
    label: 'Enroll win-back',
    example: 'Enroll win-back',
    blurb: 'Enroll lapsed quotes — with the exclusions narrated.',
  },
  {
    label: 'Campaign status',
    example: 'Campaign status',
    blurb: 'Enrolled / excluded / drafts pending per playbook.',
  },
  {
    label: 'Who should we call today',
    example: 'Who should we call today',
    blurb: 'A ranked producer worklist — texting is never suggested without consent.',
  },
  {
    label: 'Brief me on Dana',
    example: 'Brief me on Dana',
    blurb: 'A one-card brief on any contact, with consent + memory.',
  },
  {
    label: 'Research a contact',
    example: 'Research Dana',
    blurb: 'Run the first-party enrichment waterfall — book, conversations, and what needs the platform.',
  },
  {
    label: 'Take me to the Inbox',
    example: 'Take me to the Inbox',
    blurb: 'Jump to any screen or contact — “open inbox”, “take me to Dana”, “go to settings”.',
  },
  {
    label: 'Search a topic',
    example: 'Search boat',
    blurb: 'Find conversations and memory mentioning a term.',
  },
  {
    label: 'Pause everything',
    example: 'Pause everything',
    blurb: 'Flip the kill switch (typed confirm) — stops all sending.',
  },
];
