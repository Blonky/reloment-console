import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../components/index.ts';
import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
}

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const HomeIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <path d="M2.5 7 8 2.5 13.5 7" />
    <path d="M4 6.5V13h8V6.5" />
  </svg>
);

const InboxIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <path d="M2.5 3.5h11v9h-11z" />
    <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" />
  </svg>
);

const ContactsIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3.5 13c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5" />
  </svg>
);

const CampaignsIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <path d="M3 6.5 11.5 3v10L3 9.5z" />
    <path d="M3 6.5H2.5v3H3" />
    <path d="M5 10v2.5" />
  </svg>
);

const AgentsIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <rect x="3.5" y="5.5" width="9" height="7" rx="1.5" />
    <path d="M8 5.5V3" />
    <circle cx="8" cy="2.5" r="0.75" />
    <path d="M6 8.5v1.5M10 8.5v1.5" />
  </svg>
);

const InsightsIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 11.5V8M8 11.5V4.5M11.5 11.5V6.5" />
  </svg>
);

const TrustIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} className={styles.icon}>
    <path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />
    <path d="M6 8l1.5 1.5L10.5 6.5" />
  </svg>
);

const ITEMS: NavItem[] = [
  { to: '/', label: 'Home', end: true, icon: HomeIcon },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon },
  { to: '/contacts', label: 'Contacts', icon: ContactsIcon },
  { to: '/campaigns', label: 'Campaigns', icon: CampaignsIcon },
  { to: '/agents', label: 'Agents', icon: AgentsIcon },
  { to: '/insights', label: 'Insights', icon: InsightsIcon },
  { to: '/trust', label: 'Trust & Settings', icon: TrustIcon },
];

const TENANT = 'Hartley Insurance Group';

export default function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.wordmark}>Reloment</div>
      <div className={styles.nav}>
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.linkActive}` : styles.link
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </div>
      <div className={styles.footer}>
        <Avatar name={TENANT} size="sm" />
        <div className={styles.tenant}>
          <span className={styles.tenantName}>{TENANT}</span>
          <span className={styles.tenantMeta}>Demo tenant</span>
        </div>
      </div>
    </nav>
  );
}
