import { useState, useCallback } from 'react';
import { fetchTransactions, fetchSyncedTransactions, excludeTransaction, includeTransaction, unstageTransaction, syncToActual } from '../services/api';
import type { Transaction, SyncResult } from '../types';

export function useTransactions(token: string | null) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [syncedTransactions, setSyncedTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [staged, synced] = await Promise.all([
        fetchTransactions(token) as Promise<Transaction[]>,
        fetchSyncedTransactions(token) as Promise<Transaction[]>,
      ]);
      setTransactions(staged);
      setSyncedTransactions(synced);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const exclude = useCallback(async (id: string) => {
    if (!token) return;
    await excludeTransaction(token, id);
    setTransactions(prev => prev.filter(t => t.id !== id));
  }, [token]);

  const include = useCallback(async (id: string) => {
    if (!token) return;
    await includeTransaction(token, id);
    await refresh();
  }, [token, refresh]);

  const resetSynced = useCallback(async (id: string) => {
    if (!token) return;
    await unstageTransaction(token, id);
    setSyncedTransactions(prev => prev.filter(t => t.id !== id));
    setTransactions(prev => {
      // The transaction will be re-fetched on next refresh; optimistically do nothing here
      return prev;
    });
    await refresh();
  }, [token, refresh]);

  const sync = useCallback(async (): Promise<SyncResult> => {
    if (!token) throw new Error('Not authenticated');
    const result = await syncToActual(token) as SyncResult;
    await refresh();
    return result;
  }, [token, refresh]);

  return { transactions, syncedTransactions, loading, error, refresh, exclude, include, resetSynced, sync };
}
