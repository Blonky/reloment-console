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
  | { kind: 'help' } // honest capabilities card
  // Nothing matched. Never a dead-end: the transcript renders a capability card
  // with tappable chips. `general` is true when the line reads like a general
  // question / small talk (not a fragment or a near-miss command), which the UI
  // answers with an extra honesty line about the live-model boundary. The raw
  // `text` is carried so the dispatch can bias suggestions toward a contact whose
  // name appears in it (resolved against the real book, which the parser lacks).
  | { kind: 'fallback'; text: string; general: boolean };

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

// ── Fuzzy token matching (deterministic, no deps) ─────────────────────────────
// Bounded Levenshtein distance — early-exits once the running minimum exceeds
// `max`, so it never does more than a handful of comparisons per token. Used to
// tolerate typos in intent keywords ("reserch", "breif", "renwals") and in the
// contact-name fallback hint. No fuzzy library, no fuzzing of short words.
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // no cell in this row can still win
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

// Does any word in `text` fuzzy-match `keyword` within an edit distance scaled
// to word length? Short words (≤4) demand an exact match (typos there are
// ambiguous); longer words tolerate 1–2 edits. Guards a leading verb typo like
// "reserch dana" or "breif dana" without turning every line into a false hit.
function tokenFuzzyHit(text: string, keyword: string): boolean {
  const max = keyword.length <= 4 ? 0 : keyword.length <= 6 ? 1 : 2;
  if (max === 0) return false;
  for (const w of text.split(' ')) {
    if (w.length < 3) continue;
    if (levenshtein(w, keyword, max) <= max) return true;
  }
  return false;
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
  /\bwho (should|do) (we|i) (call|dial|be calling)\b/,
  /\bwho('?s| is| are we| are)? (worth )?(calling|dialing)\b/,
  /\bwho to call\b/,
  /\bwho('?s| is) worth (a )?(call|calling)\b/,
  /\bworth (a )?(call|calling)\b/,
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

// Heads that are EXACT verbs for a different intent — never treat these as a
// typo of a fuzzy verb (e.g. "search" is edit-distance 2 from "research" but is
// its own command; "find"/"look" belong to search too). Guards the fuzzy verb
// matcher from stealing a well-formed command for a neighbouring intent.
const RESERVED_HEADS = new Set([
  'search', 'find', 'look', 'show', 'open', 'go', 'take', 'who', 'what',
  'pause', 'stop', 'resume', 'enroll', 'run',
]);

// Fuzzy "verb + argument" capture: when a line starts with a typo of one of the
// given verbs ("reserch dana", "breif dana"), return the trailing argument. The
// first word must fuzzy-match a verb, must not be an exact reserved verb for
// another intent, and there must be a non-empty remainder.
function fuzzyVerbArg(text: string, verbs: string[]): string | null {
  const sp = text.indexOf(' ');
  if (sp < 0) return null;
  const head = text.slice(0, sp);
  const rest = text.slice(sp + 1).trim();
  if (!rest || RESERVED_HEADS.has(head)) return null;
  for (const v of verbs) {
    const max = v.length <= 4 ? 0 : v.length <= 6 ? 1 : 2;
    if (max === 0) continue;
    if (head.length >= 3 && levenshtein(head, v, max) <= max) return rest;
  }
  return null;
}

// Extract the first non-empty capture group from the first matching pattern.
function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      for (let i = 1; i < m.length; i += 1) {
        const group = m[i]?.trim();
        // Skip verb/interrogative-fragment groups the alternation may have
        // captured first (e.g. the "who"/"what" group in "who is X" — we want X).
        if (group && !/^(with|on|about|for|who|what|whats|is|are)$/.test(group))
          return group;
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
  // "brief me on dana" line isn't swallowed by a stray "renewal" token. A typo
  // in the verb ("breif dana", "brif dana") still routes via fuzzyVerbArg.
  const briefName =
    firstCapture(text, BRIEF_PATTERNS) ?? fuzzyVerbArg(text, ['brief']);
  if (briefName) return { kind: 'brief', name: briefName };

  // Research/enrichment ("research Ray", "enrich Dana", "look up Marcus") — a
  // named contact waterfall. Before search so "look up X" runs enrichment, not
  // a text search; the UI honestly reports an unknown name. Typo-tolerant on the
  // lead verb ("reserch dana", "enrch dana").
  const researchName =
    firstCapture(text, RESEARCH_PATTERNS) ??
    fuzzyVerbArg(text, ['research', 'enrich']);
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

  // ── Fuzzy keyword rescue (typo-tolerant, deterministic) ─────────────────────
  // Nothing matched cleanly — one more pass tolerant of a single mistyped
  // keyword ("renwals", "lapsd", "winback"→"winbck", "campain"). Ordered like
  // the exact banks so specificity holds.
  if (tokenFuzzyHit(text, 'winback') || tokenFuzzyHit(text, 'lapsed'))
    if (tokenFuzzyHit(text, 'enroll')) return { kind: 'enroll_winback' };
  if (tokenFuzzyHit(text, 'campaigns') || tokenFuzzyHit(text, 'campaign'))
    return { kind: 'campaign_status' };
  if (tokenFuzzyHit(text, 'lapsed') || tokenFuzzyHit(text, 'lapsing'))
    return { kind: 'lapsed' };
  if (tokenFuzzyHit(text, 'renewals') || tokenFuzzyHit(text, 'renewal'))
    return { kind: 'renewals' };

  // Never a dead-end. The fallback carries the raw text so the dispatch can look
  // for a real contact name in it and bias its suggestions. `general` marks lines
  // that read like a general question / small talk (a question word, a greeting,
  // or plain prose with no command tokens) — the UI adds the live-model note.
  return { kind: 'fallback', text, general: looksGeneral(text) };
}

// Heuristic: does the line read like a general question or small talk rather than
// a garbled command? True for greetings, thanks, and question-word / open prose
// with no command tokens. Deliberately conservative — a two-word fragment like
// "dana renewls" stays a near-miss (general: false) so we don't slap the
// live-model note on an obvious command typo.
function looksGeneral(text: string): boolean {
  if (/^(hi|hey|hello|yo|sup|thanks|thank you|thx|ok|okay|cool|nice)\b/.test(text))
    return true;
  const wordCount = text.split(' ').filter(Boolean).length;
  const questionish =
    /^(who|what|when|where|why|how|can|could|would|should|is|are|do|does|tell|explain|write|draft|summar|research|compare|plan)\b/.test(
      text,
    ) || text.includes('?');
  // A real question is usually more than two words; a two-word "brief dana" typo
  // that slipped through is not "general".
  return questionish && wordCount >= 3;
}

// The command catalogue — shared by the help card, the fallback card, and the
// composer chips so the three never drift. Each entry documents one shipped
// intent and carries a `group` so the fallback card can bucket the chips
// (read the book / act / research / navigate).
export type CommandGroup = 'read' | 'act' | 'research' | 'navigate';

export interface CommandDoc {
  label: string; // chip / list label
  example: string; // an example phrasing the user can click to run
  blurb: string; // one plain line describing what it does
  group: CommandGroup; // which fallback bucket it belongs to
}

export const COMMAND_CATALOGUE: CommandDoc[] = [
  {
    label: 'Show renewals',
    example: 'Show renewals',
    blurb: 'Who’s up for renewal in the next 30 days.',
    group: 'read',
  },
  {
    label: 'Who’s lapsing',
    example: 'Who’s lapsing',
    blurb: 'Lapsed quotes worth a win-back.',
    group: 'read',
  },
  {
    label: 'Campaign status',
    example: 'Campaign status',
    blurb: 'Enrolled / excluded / drafts pending per playbook.',
    group: 'read',
  },
  {
    label: 'Enroll win-back',
    example: 'Enroll win-back',
    blurb: 'Enroll lapsed quotes — with the exclusions narrated.',
    group: 'act',
  },
  {
    label: 'Who should we call today',
    example: 'Who should we call today',
    blurb: 'A ranked producer worklist — texting is never suggested without consent.',
    group: 'act',
  },
  {
    label: 'Pause everything',
    example: 'Pause everything',
    blurb: 'Flip the kill switch (typed confirm) — stops all sending.',
    group: 'act',
  },
  {
    label: 'Brief me on Dana',
    example: 'Brief me on Dana',
    blurb: 'A one-card brief on any contact, with consent + memory.',
    group: 'research',
  },
  {
    label: 'Research a contact',
    example: 'Research Dana',
    blurb: 'Run the first-party enrichment waterfall — book, conversations, and what needs the platform.',
    group: 'research',
  },
  {
    label: 'Search a topic',
    example: 'Search boat',
    blurb: 'Find conversations and memory mentioning a term.',
    group: 'research',
  },
  {
    label: 'Take me to the Inbox',
    example: 'Take me to the Inbox',
    blurb: 'Jump to any screen or contact — “open inbox”, “take me to Dana”, “go to settings”.',
    group: 'navigate',
  },
];

// The fallback card's honesty line about general questions (matches the Demo
// popover note): the demo router handles the book / campaigns / research /
// navigation; open questions run on the live model with the platform. No em dash
// in the sentence (voice canon).
export const GENERAL_QUESTION_NOTE =
  'General questions run on the live model with the platform connection. In this workspace I handle your book, campaigns, research and navigation.';

// Human labels for the four fallback groups, in display order.
export const COMMAND_GROUP_LABELS: { group: CommandGroup; label: string }[] = [
  { group: 'read', label: 'Read the book' },
  { group: 'act', label: 'Act' },
  { group: 'research', label: 'Research' },
  { group: 'navigate', label: 'Navigate' },
];
