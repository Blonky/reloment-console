// Per-playbook enrichment the campaign_status route doesn't carry: template text,
// counsel-signed flag, canonical governed run-stats, and the excluded contacts
// broken out by gate reason. Keyed by CampaignRow.key. Exclusions are first-class
// — every excluded contact carries a name + an auditReason GateReason maps.

export interface Exclusion {
  name: string;
  reason: string; // auditReason — GateReason maps it to plain English
}

export interface RunStats {
  enrolled: number;
  excluded: number;
  sent: number;
  replied: number;
}

export interface PlaybookMeta {
  template: string;
  counselSigned: boolean;
  stats: RunStats;
  exclusions: Exclusion[];
  // A one-line, honest statement of how autonomously this playbook sends —
  // draft-for-approval vs an inquiry-basis auto-acknowledgement. Optional.
  autonomyNote?: string;
}

// The canonical governed story. Numbers stay coherent:
// excluded ≤ audience · replied ≤ sent ≤ enrolled.
export const PLAYBOOK_META: Record<string, PlaybookMeta> = {
  renewal_reminder: {
    template:
      "Hi {first_name} — your policy renews soon. Tom's set aside time to review your options before anything changes. Want to grab 15 minutes this week?",
    counselSigned: true,
    stats: { enrolled: 3, excluded: 0, sent: 3, replied: 2 },
    exclusions: [],
    autonomyNote: 'Draft-for-approval — every send waits on you.',
  },
  speed_to_lead: {
    template:
      "Hi {first_name} — thanks for reaching out about a quote. I can get your numbers together today; what's the best time for a quick call?",
    counselSigned: true,
    stats: { enrolled: 1, excluded: 0, sent: 1, replied: 1 },
    exclusions: [],
    autonomyNote: 'Draft-for-approval — every send waits on you.',
  },
  winback_lapsed: {
    template:
      "Hi {first_name} — your quote from earlier this year is about to expire. Rates moved recently, so it's worth a fresh look before it does. Want updated numbers?",
    counselSigned: true,
    stats: { enrolled: 2, excluded: 2, sent: 2, replied: 1 },
    exclusions: [
      { name: 'Sam Ortiz', reason: 'opted_out' },
      { name: 'Lee Nguyen', reason: 'no_marketing_consent' },
    ],
    autonomyNote: 'Draft-for-approval — every send waits on you.',
  },
  missed_call: {
    template:
      "Sorry we missed your call — this is Hartley Insurance's text line. How can we help?",
    counselSigned: true,
    // Triggered by inbound calls, not enrolled — the acknowledgement auto-sends
    // on inquiry basis and still clears the gate.
    stats: { enrolled: 1, excluded: 0, sent: 1, replied: 1 },
    exclusions: [],
    autonomyNote: 'Auto-sends the acknowledgment — inquiry basis, still gated.',
  },
  bundle_upsell: {
    template:
      "Hi {first_name} — you're insured on auto with us. Bundling your home policy usually trims both premiums. Want Tom to run the combined number?",
    counselSigned: true,
    stats: { enrolled: 3, excluded: 1, sent: 3, replied: 1 },
    exclusions: [{ name: 'Sam Ortiz', reason: 'opted_out' }],
    autonomyNote: 'Draft-for-approval — every send waits on you.',
  },
};

// Fall back to a coherent zero-story for any playbook not in the map.
export function metaFor(key: string): PlaybookMeta {
  return (
    PLAYBOOK_META[key] ?? {
      template: '',
      counselSigned: true,
      stats: { enrolled: 0, excluded: 0, sent: 0, replied: 0 },
      exclusions: [],
    }
  );
}

/** transactional → info "Transactional"; marketing → hold "Marketing". */
export function classificationTone(c: string): 'info' | 'hold' {
  return c === 'marketing' ? 'hold' : 'info';
}

export function classificationLabel(c: string): string {
  return c === 'marketing' ? 'Marketing' : 'Transactional';
}
