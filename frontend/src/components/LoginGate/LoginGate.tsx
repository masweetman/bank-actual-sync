import { useState, FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { setupAdmin } from '../../services/settingsApi';
import styles from './LoginGate.module.css';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { state, login, verify2FA, onSetupComplete } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (state.status === 'loading') {
    return <div className={styles.container}><p className={styles.loading}>Loading…</p></div>;
  }

  if (state.status === 'authenticated') {
    return <>{children}</>;
  }

  // ── First-run setup ────────────────────────────────────────────────────────
  if (state.status === 'setup_required') {
    const handleSetup = async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
      if (password !== confirmPassword) { setError('Passwords do not match'); return; }
      setLoading(true);
      try {
        await setupAdmin(password);
        onSetupComplete();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Setup failed');
      } finally { setLoading(false); }
    };
    return (
      <div className={styles.container}>
        <form className={styles.form} onSubmit={handleSetup}>
          <h1 className={styles.title}>Bank Sync</h1>
          <p className={styles.subtitle}>Create your admin password to get started.</p>
          <label className={styles.label} htmlFor="new-password">New Password</label>
          <input id="new-password" className={styles.input} type="password" value={password}
            onChange={e => setPassword(e.target.value)} minLength={8} required />
          <label className={styles.label} htmlFor="confirm-password">Confirm Password</label>
          <input id="confirm-password" className={styles.input} type="password" value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)} minLength={8} required />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Setting up…' : 'Create Password'}
          </button>
        </form>
      </div>
    );
  }

  // ── 2FA verification ───────────────────────────────────────────────────────
  if (state.status === 'awaiting_2fa') {
    const handleVerify = async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setLoading(true);
      try { await verify2FA(mfaCode); }
      catch (err) { setError(err instanceof Error ? err.message : 'Invalid code'); }
      finally { setLoading(false); }
    };
    return (
      <div className={styles.container}>
        <form className={styles.form} onSubmit={handleVerify}>
          <h1 className={styles.title}>Bank Sync</h1>
          <p className={styles.subtitle}>Enter the 6-digit code from your authenticator app.</p>
          <label className={styles.label} htmlFor="mfa-code">Authentication Code</label>
          <input id="mfa-code" className={styles.input} type="text" inputMode="numeric"
            pattern="[0-9]*" maxLength={6} value={mfaCode} autoFocus autoComplete="one-time-code"
            onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.button} type="submit" disabled={loading || mfaCode.length < 6}>
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    );
  }

  // ── Normal login ───────────────────────────────────────────────────────────
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try { await login(password); }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed'); }
    finally { setLoading(false); }
  };
  return (
    <div className={styles.container}>
      <form className={styles.form} onSubmit={handleLogin}>
        <h1 className={styles.title}>Bank Sync</h1>
        <label className={styles.label} htmlFor="password">Admin Password</label>
        <input id="password" className={styles.input} type="password" value={password}
          onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.button} type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
