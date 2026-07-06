// Contact detail — the slide-in inspector for a contact (DESIGN.md §6). It now
// converges on the shared Inspector primitive (§5): the panel shell, header,
// close button, Escape/scrim/focus, and portal all come from Inspector. This
// file owns only the CONTENT — the memory board, consent, the Data sources
// section (the book-enrichment story), and the open-thread link.

import { Link } from 'react-router-dom';
import { Avatar, ConsentChips, StatusPill } from '../../components/index.ts';
import Inspector from '../../shell/Inspector.tsx';
import type { Contact } from '../../data/types.ts';
import {
  policyTone,
  humanizeLabel,
  groupMemory,
  sourceProvenance,
  atomDate,
  dataSourcesFor,
  type DataSourceKind,
} from './contactsUtils.ts';
import styles from './ContactDetail.module.css';

export interface ContactDetailProps {
  contact: Contact;
  onClose: () => void;
}

// 16px source glyphs — stroke 1.5, drawn as needed (no icon pack).
const strokeProps = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const SOURCE_ICON: Record<DataSourceKind, React.ReactNode> = {
  ams: (
    <svg width="16" height="16" viewBox="0 0 16 16" {...strokeProps} aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 9.5h5" />
    </svg>
  ),
  conversations: (
    <svg width="16" height="16" viewBox="0 0 16 16" {...strokeProps} aria-hidden="true">
      <path d="M3 3.5h10v6H6.5L4 12V9.5H3z" />
    </svg>
  ),
  carrier: (
    <svg width="16" height="16" viewBox="0 0 16 16" {...strokeProps} aria-hidden="true">
      <path d="M8 2v12M4 5l4-3 4 3M4.5 8.5h7" />
    </svg>
  ),
};

export default function ContactDetail({ contact, onClose }: ContactDetailProps) {
  const groups = groupMemory(contact.memory);
  const sources = dataSourcesFor(contact);

  return (
    <Inspector open onClose={onClose} title={`${contact.display_name} detail`}>
      {/* 1 · Contact header */}
      <header className={styles.header}>
        <Avatar name={contact.display_name} size="lg" />
        <div className={styles.identity}>
          <span className={styles.name}>{contact.display_name}</span>
          <span className={styles.e164}>{contact.e164}</span>
          <div className={styles.headerMeta}>
            <span className={styles.lob}>{contact.lob ?? '—'}</span>
            <span className={styles.metaDot} />
            <StatusPill tone={policyTone(contact.policy_status)}>
              {humanizeLabel(contact.policy_status)}
            </StatusPill>
          </div>
        </div>
      </header>

      {/* 2 · Data sources — the book-enrichment story (first-party only). */}
      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Data sources</h3>
        <ul className={styles.sourceList}>
          {sources.map((s) => (
            <li key={s.kind} className={styles.source}>
              <span className={styles.sourceIcon}>{SOURCE_ICON[s.kind]}</span>
              <span className={styles.sourceBody}>
                <span className={styles.sourceTop}>
                  <span className={styles.sourceName}>{s.name}</span>
                  <span
                    className={`${styles.sourceFresh} ${
                      s.freshness === 'live' ? styles.sourceFreshLive : ''
                    }`}
                  >
                    {s.freshness}
                  </span>
                </span>
                <span className={styles.sourceContribution}>{s.contribution}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 3 · Memory board */}
      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Memory board</h3>
        {groups.length === 0 ? (
          <p className={styles.emptyNote}>
            No memory recorded yet — atoms accrue from conversations and call notes.
          </p>
        ) : (
          <div className={styles.groups}>
            {groups.map((group) => (
              <div key={group.source} className={styles.group}>
                <span className={styles.groupLabel}>{group.label}</span>
                <ul className={styles.atomList}>
                  {group.atoms.map(({ atom, index }) => (
                    <li key={index} className={styles.atom}>
                      <span className={styles.atomBullet} />
                      <span className={styles.atomBody}>
                        <span className={styles.atomValue}>{atom.value}</span>
                        <span className={styles.atomProvenance}>
                          {sourceProvenance(atom.source)} · {atomDate(index)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4 · Consent detail */}
      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Consent</h3>
        <ConsentChips
          consents={contact.consents}
          timezone={contact.timezone}
          optedOut={contact.optedOut}
        />
      </section>

      {/* 5 · Open thread */}
      <div className={styles.footer}>
        <Link to={`/inbox?c=${contact.id}`} className={styles.threadLink} onClick={onClose}>
          Open thread
          <ArrowIcon />
        </Link>
      </div>
    </Inspector>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 7h8M7.5 3.5L11 7l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
