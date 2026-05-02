import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSocket } from '../../hooks/useSocket';
import { useTransactions } from '../../hooks/useTransactions';
import { SyncStatus } from '../../components/SyncStatus';
import { TransactionTable } from '../../components/TransactionTable';
import type { SyncEvent } from '../../types';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const { token, logout } = useAuth();
  // token is always non-null here (App.tsx guards for authenticated state)
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [syncing, setSyncing] = useState(false);

  const { transactions, syncedTransactions, loading, refresh, exclude, sync, resetSynced } = useTransactions(token);

  const handleEvent = useCallback((event: SyncEvent) => {
    setEvents(prev => [...prev, event]);

    if (event.type === 'SYNC_STARTED') {
      setSyncing(true);
    }
    if (
      event.type === 'TRANSACTIONS_FETCHED' ||
      event.type === 'SYNC_COMPLETE' ||
      event.type === 'SYNC_ERROR'
    ) {
      setSyncing(false);
      void refresh();
    }
  }, [refresh]);

  const { triggerSync } = useSocket(token, handleEvent);

  // Load transactions on mount
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.logo}>Bank Sync</h1>
        <button className={styles.logoutBtn} onClick={logout}>Log out</button>
      </header>

      <main className={styles.main}>
        <SyncStatus events={events} onTriggerSync={triggerSync} syncing={syncing} />

        <TransactionTable
          transactions={transactions}
          syncedTransactions={syncedTransactions}
          onExclude={exclude}
          onSyncToActual={sync}
          onRefresh={refresh}
          onResetSynced={resetSynced}
          loading={loading}
        />
      </main>
    </div>
  );
}
