import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, StatusPill, ConsentChips } from '../../components/index.ts';
import type { Contact } from '../../data/types.ts';
import {
  policyTone,
  humanizeLabel,
  groupMemory,
  sourceProvenance,
  atomDate,
} from './contactsUtils.ts';
import styles from './ContactDetail.module.css';

export interface ContactDetailProps {
  contact: Contact;
  onClose: () => void;
}

export default function ContactDetail({ contact, onClose }: ContactDetailProps) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = groupMemory(contact.memory);

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${contact.display_name} detail`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

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

        {/* 2 · Memory board */}
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

        {/* 3 · Consent detail */}
        <section className={styles.section}>
          <h3 className={styles.sectionLabel}>Consent</h3>
          <ConsentChips
            consents={contact.consents}
            timezone={contact.timezone}
            optedOut={contact.optedOut}
          />
        </section>

        {/* 4 · Open thread */}
        <div className={styles.footer}>
          <Link to={`/inbox?c=${contact.id}`} className={styles.threadLink} onClick={onClose}>
            Open thread
            <ArrowIcon />
          </Link>
        </div>
      </aside>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
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
