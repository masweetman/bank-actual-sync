import { useState } from 'react';
import type { Transaction, SyncResult } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatCurrency';
import styles from './TransactionTable.module.css';

interface TransactionTableProps {
  transactions: Transaction[];
  syncedTransactions: Transaction[];
  onExclude: (id: string) => Promise<void>;
  onSyncToActual: () => Promise<SyncResult>;
  onRefresh: () => Promise<void>;
  onResetSynced: (id: string) => Promise<void>;
  loading: boolean;
}

export function TransactionTable({
  transactions,
  syncedTransactions,
  onExclude,
  onSyncToActual,
  onRefresh,
  onResetSynced,
  loading,
}: TransactionTableProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showSynced, setShowSynced] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await onSyncToActual();
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const included = transactions; // all staged are "included" until excluded
  const pendingCount = included.filter(t => !t.cleared).length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          Staged Transactions
          {!loading && <span className={styles.count}>{included.length}</span>}
        </h2>
        <div className={styles.actions}>
          <button className={styles.refreshBtn} onClick={onRefresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            className={styles.syncBtn}
            onClick={handleSync}
            disabled={syncing || included.length === 0}
          >
            {syncing ? 'Pushing to Actual…' : `Sync ${included.length} to Actual`}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={styles.syncResult} role="status">
          Imported {syncResult.imported}, skipped {syncResult.skipped} (duplicates).
          {syncResult.errors.length > 0 && (
            <span className={styles.syncErrors}> Errors: {syncResult.errors.join('; ')}</span>
          )}
        </div>
      )}
      {syncError && (
        <div className={styles.syncError} role="alert">{syncError}</div>
      )}
      {pendingCount > 0 && (
        <div className={styles.pendingNote}>
          {pendingCount} pending transaction{pendingCount !== 1 ? 's' : ''} — will be imported as
          uncleared with "PENDING:" prefix.
        </div>
      )}

      {included.length === 0 ? (
        <p className={styles.empty}>
          No staged transactions. Run a sync to scrape the latest transactions.
        </p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Memo</th>
                <th className={styles.amountCol}>Amount</th>
                <th>Status</th>
                <th>Account</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {included.map(t => (
                <tr
                  key={t.id}
                  className={`${styles.row} ${!t.cleared ? styles.pending : ''}`}
                >
                  <td>{formatDate(t.date)}</td>
                  <td className={styles.payee}>{t.payee}</td>
                  <td className={styles.memo}>{t.memo}</td>
                  <td className={`${styles.amountCol} ${t.amount < 0 ? styles.debit : styles.credit}`}>
                    {formatCurrency(t.amount)}
                  </td>
                  <td>
                    <span className={t.cleared ? styles.cleared : styles.pendingBadge}>
                      {t.cleared ? 'Cleared' : 'Pending'}
                    </span>
                  </td>
                  <td>{t.bank_account.replace(/_/g, ' ')}</td>
                  <td>
                    <button
                      className={styles.excludeBtn}
                      onClick={() => onExclude(t.id)}
                      title="Exclude this transaction from the sync"
                    >
                      Exclude
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {syncedTransactions.length > 0 && (
        <div className={styles.syncedSection}>
          <button
            className={styles.syncedToggle}
            onClick={() => setShowSynced(v => !v)}
          >
            {showSynced ? '▾' : '▸'} Synced Transactions
            <span className={styles.count}>{syncedTransactions.length}</span>
          </button>

          {showSynced && (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Memo</th>
                    <th className={styles.amountCol}>Amount</th>
                    <th>Account</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {syncedTransactions.map(t => (
                    <tr key={t.id} className={styles.syncedRow}>
                      <td>{formatDate(t.date)}</td>
                      <td className={styles.payee}>{t.payee}</td>
                      <td className={styles.memo}>{t.memo}</td>
                      <td className={`${styles.amountCol} ${t.amount < 0 ? styles.debit : styles.credit}`}>
                        {formatCurrency(t.amount)}
                      </td>
                      <td>{t.bank_account.replace(/_/g, ' ')}</td>
                      <td>
                        <button
                          className={styles.resetBtn}
                          onClick={() => onResetSynced(t.id)}
                          title="Move back to staged"
                        >
                          Reset
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
