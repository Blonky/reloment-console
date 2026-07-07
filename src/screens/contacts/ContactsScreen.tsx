import { useEffect, useState } from 'react';
import {
  Card,
  Avatar,
  StatusPill,
  ConsentChips,
  EmptyState,
  Skeleton,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '../../components/index.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type { Contact } from '../../data/types.ts';
import ContactDetail from './ContactDetail.tsx';
import { policyTone, humanizeLabel, relativeFrom } from './contactsUtils.ts';
import styles from './ContactsScreen.module.css';

export default function ContactsScreen() {
  const client = useClient();
  const { data, loading, error, refetch } = useData(() => client.contacts(), [client]);
  const [selected, setSelected] = useState<Contact | null>(null);

  // Memory evolution (r20): when the agent learns/corrects a fact about a
  // contact, refetch the book so the memory board here reflects it live —
  // "each control panel understands as the agent evolves."
  useEffect(() => {
    return client.subscribe((e) => {
      if (e.type === 'memory.changed') refetch();
    });
  }, [client, refetch]);

  // Keep the open detail panel pointed at the FRESH row after a refetch, so a
  // just-learned memory appears without closing/reopening the panel.
  const selectedFresh =
    selected === null ? null : (data?.find((c) => c.id === selected.id) ?? selected);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Contacts</h1>
        <p className={styles.pageSub}>
          {data === undefined
            ? 'The book of business'
            : `${data.length} ${data.length === 1 ? 'person' : 'people'} in the book`}
        </p>
      </header>

      {loading ? (
        <ContactsSkeleton />
      ) : error !== undefined ? (
        <Card>
          <EmptyState message="Couldn't load the contact book. The connection to the platform dropped — refresh to try again." />
        </Card>
      ) : data === undefined || data.length === 0 ? (
        <Card>
          <EmptyState message="No contacts in the book yet. Contacts appear here as they're imported from the agency's book of business." />
        </Card>
      ) : (
        <Card padded={false}>
          <div className={styles.tableScroll}>
            <Table>
              <THead>
                <TR>
                  <TH>Contact</TH>
                  <TH>Phone</TH>
                  <TH>Line</TH>
                  <TH>Policy</TH>
                  <TH>Renews</TH>
                  <TH>Consent</TH>
                  <TH>Last activity</TH>
                </TR>
              </THead>
              <TBody>
                {data.map((c) => (
                  <TR key={c.id} clickable onClick={() => setSelected(c)}>
                    <TD>
                      <span className={styles.nameCell}>
                        <Avatar name={c.display_name} size="sm" />
                        <span className={styles.name}>{c.display_name}</span>
                      </span>
                    </TD>
                    <TD>
                      <span className={styles.tnum}>{c.e164}</span>
                    </TD>
                    <TD>{c.lob ?? '—'}</TD>
                    <TD>
                      <StatusPill tone={policyTone(c.policy_status)}>
                        {humanizeLabel(c.policy_status)}
                      </StatusPill>
                    </TD>
                    <TD num>{c.x_date === null ? '—' : c.x_date}</TD>
                    <TD>
                      <ConsentChips consents={c.consents} optedOut={c.optedOut} />
                    </TD>
                    <TD>
                      <span className={styles.activity}>{relativeFrom(c.lastActivity)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {selectedFresh !== null && (
        <ContactDetail contact={selectedFresh} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ContactsSkeleton() {
  return (
    <Card padded={false}>
      <div className={styles.skelWrap}>
        <div className={styles.skelHead}>
          <Skeleton width={90} height={11} />
          <Skeleton width={70} height={11} />
          <Skeleton width={50} height={11} />
          <Skeleton width={60} height={11} />
          <Skeleton width={70} height={11} />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skelRow}>
            <span className={styles.skelName}>
              <Skeleton width={26} height={26} radius="50%" />
              <Skeleton width={120} height={13} />
            </span>
            <Skeleton width={110} height={13} />
            <Skeleton width={64} height={13} />
            <Skeleton width={72} height={20} radius="999px" />
            <Skeleton width={140} height={20} radius="999px" />
          </div>
        ))}
      </div>
    </Card>
  );
}
