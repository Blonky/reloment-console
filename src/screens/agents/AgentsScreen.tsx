import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import { Card, EmptyState, Skeleton, Button } from '../../components/index.ts';
import AgentCard from './AgentCard.tsx';
import styles from './AgentsScreen.module.css';

function LadderSkeleton() {
  return (
    <Card>
      <div className={styles.skelHead}>
        <div className={styles.skelIdentity}>
          <Skeleton width={150} height={16} />
          <Skeleton width={110} height={12} />
        </div>
        <Skeleton width={78} height={18} radius="999px" />
      </div>
      <div className={styles.skelRow}>
        <Skeleton width={120} height={22} radius="999px" />
        <Skeleton width={104} height={22} radius="999px" />
      </div>
      <Skeleton width="100%" height={128} />
      <Skeleton width={260} height={30} />
    </Card>
  );
}

export default function AgentsScreen() {
  const client = useClient();
  const { data, loading, error, refetch } = useData(() => client.agents(), [client]);

  const lineNumber = '+1 512 555 0100';

  let body;
  if (loading) {
    body = (
      <div className={styles.grid}>
        <LadderSkeleton />
        <LadderSkeleton />
        <LadderSkeleton />
      </div>
    );
  } else if (error !== undefined) {
    body = (
      <Card>
        <EmptyState
          message="We couldn't load the agent roster. This is usually a momentary connection issue."
          action={
            <Button variant="secondary" size="sm" onClick={refetch}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  } else if (data === undefined || data.length === 0) {
    body = (
      <Card>
        <EmptyState message="No line agents are configured yet. Agents appear here once a line is provisioned and a playbook is attached." />
      </Card>
    );
  } else {
    body = (
      <div className={styles.grid}>
        {data.map((agent) => (
          <AgentCard key={agent.key} agent={agent} />
        ))}
      </div>
    );
  }

  const count = data?.length ?? 0;
  const sub =
    loading || error !== undefined
      ? 'Line agents and their autonomy ceilings.'
      : `${count} line ${count === 1 ? 'agent' : 'agents'} on ${lineNumber}`;

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.title}>Agents</h1>
        <p className={styles.sub}>{sub}</p>
      </header>
      {body}
    </div>
  );
}
