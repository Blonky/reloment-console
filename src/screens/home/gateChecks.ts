// Gate disclosure — the honest per-intent map of which deterministic send-gate
// checks each command actually exercises (DESIGN.md §5).
//
// The send gate runs a fixed ordered ladder of checks. Not every command touches
// every check — a read-only book query attempts no sends, so it runs NONE; the
// enroll command runs the full ladder once per candidate; the kill switch is a
// control action, not a gated send. This module encodes that honestly so the
// disclosure never fabricates checks a command didn't run.
//
// Per-check TIMING is never invented: the transcript measures one real duration
// (a performance.now() delta around the client call) and shows it for the run.

import type { Intent } from './parseIntent.ts';

// The gate ladder, in evaluation order (DESIGN.md §5).
export type GateCheckKey =
  | 'kill_switch'
  | 'opt_out_scrub'
  | 'consent_scope'
  | 'line_registration'
  | 'quiet_hours'
  | 'autonomy_ceiling';

export interface GateCheckDef {
  key: GateCheckKey;
  label: string;
}

// Ordered gate ladder — the disclosure lists checks in exactly this order.
export const GATE_LADDER: GateCheckDef[] = [
  { key: 'kill_switch', label: 'Kill switch' },
  { key: 'opt_out_scrub', label: 'Opt-out scrub' },
  { key: 'consent_scope', label: 'Consent scope' },
  { key: 'line_registration', label: 'Line registration' },
  { key: 'quiet_hours', label: 'Quiet hours' },
  { key: 'autonomy_ceiling', label: 'Autonomy ceiling' },
];

export type CheckOutcome = 'pass' | 'hold' | 'block';

export interface GateCheckResult {
  key: GateCheckKey;
  label: string;
  outcome: CheckOutcome;
  // A short factual note — e.g. "2 passed, 2 blocked" for a per-candidate run.
  note?: string;
}

// The shape the disclosure renders. `kind` distinguishes the three honest modes:
//   read_only  — no sends attempted (query_book, brief, search): show a calm
//                "Read-only · no sends attempted" line, no fake check dots.
//   control    — the kill switch: a control action, not a gated send.
//   gated      — enroll: the full ladder with per-check outcomes summarized.
export type GateDisclosure =
  | { kind: 'read_only' }
  | { kind: 'control' }
  | { kind: 'gated'; checks: GateCheckResult[] };

// Build the disclosure for a dispatched intent. For the enroll path the caller
// passes the real EnrollResult counts so the summary ("2 passed, 2 blocked") is
// honest; everything else is static per the intent's nature.
export function disclosureFor(
  intent: Intent,
  enroll?: { enrolledCount: number; excludedReasons: string[] },
): GateDisclosure {
  switch (intent.kind) {
    // Read-only book/brief/search reads attempt no sends → run no gate checks.
    case 'renewals':
    case 'lapsed':
    case 'brief':
    case 'search':
      return { kind: 'read_only' };

    // The kill switch is a control action — it toggles the gate, not a send.
    case 'pause':
    case 'resume':
      return { kind: 'control' };

    case 'campaign_status':
      // Reading campaign state attempts no sends either.
      return { kind: 'read_only' };

    case 'enroll_winback': {
      const enrolledCount = enroll?.enrolledCount ?? 0;
      const excludedReasons = enroll?.excludedReasons ?? [];
      const excludedCount = excludedReasons.length;
      const total = enrolledCount + excludedCount;

      // Which excluded reasons map onto which ladder check. The candidates that
      // clear a check pass it; the ones excluded at that check block it. Every
      // enrolled candidate passes every check by definition.
      const optOutBlocks = excludedReasons.filter((r) =>
        /opted_out|opt.?out/.test(r),
      ).length;
      const consentBlocks = excludedReasons.filter((r) =>
        /consent/.test(r),
      ).length;
      const registrationBlocks = excludedReasons.filter((r) =>
        /line_not_registered|unregistered/.test(r),
      ).length;
      const quietHolds = excludedReasons.filter((r) =>
        /quiet_hours/.test(r),
      ).length;
      const autonomyBlocks = excludedReasons.filter((r) =>
        /autonomy|exceeds_autonomy/.test(r),
      ).length;

      // Kill switch: a run only proceeds when it's off, so it passes for all.
      const passNote = (blocked: number): string => {
        const passed = total - blocked;
        if (blocked === 0) return `${total} passed`;
        return `${passed} passed, ${blocked} ${
          blocked === 1 ? 'held back' : 'held back'
        }`;
      };

      const mk = (
        key: GateCheckKey,
        label: string,
        blocked: number,
        outcome: CheckOutcome,
      ): GateCheckResult => ({
        key,
        label,
        outcome: blocked > 0 ? outcome : 'pass',
        note: passNote(blocked),
      });

      return {
        kind: 'gated',
        checks: [
          mk('kill_switch', 'Kill switch', 0, 'block'),
          mk('opt_out_scrub', 'Opt-out scrub', optOutBlocks, 'block'),
          mk('consent_scope', 'Consent scope', consentBlocks, 'block'),
          mk('line_registration', 'Line registration', registrationBlocks, 'block'),
          mk('quiet_hours', 'Quiet hours', quietHolds, 'hold'),
          mk('autonomy_ceiling', 'Autonomy ceiling', autonomyBlocks, 'block'),
        ],
      };
    }

    case 'help':
      return { kind: 'read_only' };
  }
}

// Count of checks the disclosure will show (for the collapsed "N checks" line).
export function disclosureCheckCount(d: GateDisclosure): number {
  return d.kind === 'gated' ? d.checks.length : 0;
}

// Format a duration in ms as a compact seconds string ("0.3s").
export function formatDuration(ms: number): string {
  const secs = ms / 1000;
  if (secs < 0.05) return '<0.1s';
  return `${secs.toFixed(1)}s`;
}
