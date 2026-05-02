import { useState, FormEvent } from 'react';
import { fetchActualAccounts, updateAccount } from '../../services/settingsApi';
import type { ActualAccount } from '../../types';
import styles from './LinkToActualModal.module.css';

interface LinkToActualModalProps {
  token: string;
  account: { id: string; name: string };
  onClose: () => void;
  onSaved: () => void;
}

type Step = 'credentials' | 'select';

export function LinkToActualModal({ token, account, onClose, onSaved }: LinkToActualModalProps) {
  const [step, setStep] = useState<Step>('credentials');
  const [syncId, setSyncId] = useState('');
  const [actualAccounts, setActualAccounts] = useState<ActualAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const accounts = await fetchActualAccounts(token, syncId);
      setActualAccounts(accounts);
      setSelectedId(accounts[0]?.id ?? null);
      setStep('select');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Actual');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    try {
      await updateAccount(token, account.id, {
        name: account.name,
        actual_id: selectedId,
        actual_sync_id: syncId,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save link');
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep('credentials');
    setError('');
    setSelectedId(null);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-label={`Link ${account.name} to Actual`}>
        <div className={styles.header}>
          <h2 className={styles.title}>Link to Actual</h2>
          <button className={styles.closeBtn} type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className={styles.subtitle}>Linking: <strong>{account.name}</strong></p>

        {step === 'credentials' && (
          <form onSubmit={handleConnect} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="lta-sync-id">Sync ID</label>
              <input
                id="lta-sync-id"
                className={styles.input}
                type="text"
                value={syncId}
                onChange={e => setSyncId(e.target.value)}
                placeholder="e.g. abc123-..."
                required
                autoFocus
              />
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button className={styles.primaryBtn} type="submit" disabled={loading}>
                {loading ? 'Connecting…' : 'Connect'}
              </button>
              <button className={styles.ghostBtn} type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}

        {step === 'select' && (
          <div>
            <p className={styles.instructions}>Select the Actual account to link to <strong>{account.name}</strong>:</p>
            <div className={styles.accountList}>
              {actualAccounts.map(acct => (
                <label key={acct.id} className={`${styles.accountOption} ${selectedId === acct.id ? styles.accountOptionSelected : ''}`}>
                  <input
                    type="radio"
                    name="actual-account"
                    value={acct.id}
                    checked={selectedId === acct.id}
                    onChange={() => setSelectedId(acct.id)}
                    className={styles.radio}
                  />
                  <span className={styles.accountName}>{acct.name}</span>
                  <span className={styles.accountId}>{acct.id}</span>
                </label>
              ))}
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button
                className={styles.primaryBtn}
                type="button"
                onClick={handleSave}
                disabled={loading || !selectedId}
              >
                {loading ? 'Saving…' : 'Save'}
              </button>
              <button className={styles.ghostBtn} type="button" onClick={handleBack} disabled={loading}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
