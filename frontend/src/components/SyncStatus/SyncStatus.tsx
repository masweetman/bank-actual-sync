import type { SyncEvent } from '../../types';
import styles from './SyncStatus.module.css';

interface SyncStatusProps {
  events: SyncEvent[];
  onTriggerSync: () => void;
  syncing: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  SYNC_STARTED:          'Sync started',
  TRANSACTIONS_FETCHED:  'Transactions fetched',
  SYNC_COMPLETE:         'Sync complete',
  SYNC_ERROR:            'Error',
};

export function SyncStatus({ events, onTriggerSync, syncing }: SyncStatusProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Sync</h2>
        <button
          className={styles.syncBtn}
          onClick={onTriggerSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      <ul className={styles.log} aria-label="Sync activity log" aria-live="polite">
        {events.length === 0 && (
          <li className={styles.empty}>No activity yet. Click "Sync Now" to start.</li>
        )}
        {[...events].reverse().map((e, i) => (
          <li
            key={i}
            className={`${styles.entry} ${e.type === 'SYNC_ERROR' ? styles.error : ''}`}
          >
            <span className={styles.time}>
              {new Date(e.timestamp).toLocaleTimeString()}
            </span>
            <span className={styles.message}>
              {EVENT_LABELS[e.type] ?? e.type}
              {e.type === 'TRANSACTIONS_FETCHED' && typeof e.payload.count === 'number'
                ? ` (${e.payload.count} new, ${e.payload.staged} staged)`
                : ''}
              {e.type === 'SYNC_ERROR' && typeof e.payload.message === 'string'
                ? `: ${e.payload.message}`
                : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
