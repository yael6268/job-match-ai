import { useEffect, useRef, useState } from 'react';
import { SettingsScreen } from './screens/SettingsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { CvsScreen } from './screens/CvsScreen';
import { JobsDbScreen } from './screens/JobsDbScreen';
import { StatsScreen } from './screens/StatsScreen';
import { TodayScreen } from './screens/TodayScreen';
import { EmptyState } from './components/EmptyState';

type TabId = 'today' | 'jobs' | 'cvs' | 'profile' | 'contacts' | 'stats' | 'settings';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'today', icon: '✨', label: 'ההתאמות היומיות' },
  { id: 'jobs', icon: '💼', label: 'מאגר המשרות' },
  { id: 'cvs', icon: '📄', label: 'קורות חיים' },
  { id: 'profile', icon: '📝', label: 'פרטי הגשה' },
  { id: 'contacts', icon: '👥', label: 'אנשי קשר' },
  { id: 'stats', icon: '📊', label: 'סטטיסטיקה' },
  { id: 'settings', icon: '⚙️', label: 'הגדרות' },
];

/** Screens not built yet show which milestone delivers them. */
const COMING: Partial<Record<TabId, string>> = {
  contacts: 'יגיע בשלב 8',
};

export function App() {
  const [tab, setTab] = useState<TabId>('today');
  const current = TABS.find((t) => t.id === tab)!;
  const activeRef = useRef<HTMLButtonElement>(null);

  // The tab strip scrolls horizontally in a narrow panel; keep the active tab visible.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  return (
    <div className="app">
      <nav className="tabs" role="tablist" aria-label="מסכים">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={t.id === tab ? activeRef : undefined}
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? 'tab tab--active' : 'tab'}
            onClick={() => setTab(t.id)}
            title={t.label}
          >
            <span className="tab__icon" aria-hidden>{t.icon}</span>
            <span className="tab__label">{t.label}</span>
          </button>
        ))}
      </nav>
      <main className="screen" role="tabpanel">
        <h1 className="screen__title">{current.icon} {current.label}</h1>
        {tab === 'today' && <TodayScreen />}
        {tab === 'settings' && <SettingsScreen />}
        {tab === 'profile' && <ProfileScreen />}
        {tab === 'cvs' && <CvsScreen />}
        {tab === 'jobs' && <JobsDbScreen />}
        {tab === 'stats' && <StatsScreen />}
        {COMING[tab] && <EmptyState icon="🚧" title="בבנייה" text={COMING[tab]} />}
      </main>
    </div>
  );
}
