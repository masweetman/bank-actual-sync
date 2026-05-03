import { useState, useEffect, useCallback, FormEvent } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { useAuth } from '../../hooks/useAuth';
import {
  getSettings, saveSettings, changePassword,
  setup2FA, enable2FA, disable2FA,
  createLinkToken, exchangePlaidToken, listPlaidItems, deletePlaidItem, createReconnectLinkToken,
  createAccount, updateAccount, deleteAccount,
  runScheduleNow,
} from '../../services/settingsApi';
import { LinkToActualModal } from '../../components/LinkToActualModal/LinkToActualModal';
import type { AppSettings, PlaidItem } from '../../types';
import styles from './Settings.module.css';

type Tab = 'banks' | 'actual' | 'security' | 'schedule';

// ─── Inline account row ───────────────────────────────────────────────────────

interface AccountRowProps {
  acct: { id: string; name: string; plaid_account_id: string };
  onUpdate: (name: string) => Promise<void>;
  onDelete: () => void;
  onLinkToActual: () => void;
}

function AccountRow({ acct, onUpdate, onDelete, onLinkToActual }: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(acct.name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onUpdate(name);
    setSaving(false);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', fontSize: '0.875rem' }}>
        <span style={{ flex: 1 }}>{acct.name}</span>
        <button className={styles.ghostBtn} type="button" onClick={onLinkToActual}>Link to Actual</button>
        <button className={styles.ghostBtn} type="button" onClick={() => setEditing(true)}>Rename</button>
        <button className={styles.dangerGhostBtn} type="button" onClick={onDelete}>Remove</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0' }}>
      <input className={styles.input} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Display name" style={{ flex: 1 }} />
      <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>{saving ? '…' : 'Save'}</button>
      <button className={styles.ghostBtn} type="button" onClick={() => { setEditing(false); setName(acct.name); }}>Cancel</button>
    </div>
  );
}

// ─── Plaid Link wrapper (must be a child component so usePlaidLink can be called conditionally) ─────

interface PlaidConnectButtonProps {
  linkToken: string;
  onSuccess: (publicToken: string) => Promise<void>;
}

function PlaidConnectButton({ linkToken, onSuccess }: PlaidConnectButtonProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token) => { void onSuccess(public_token); },
  });
  return (
    <button className={styles.saveBtn} type="button" onClick={() => open()} disabled={!ready}>
      Connect a Bank
    </button>
  );
}
interface ReconnectButtonProps {
  linkToken: string;
  onSuccess: () => void;
}

function ReconnectButton({ linkToken, onSuccess }: ReconnectButtonProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: () => onSuccess(),
  });
  return (
    <button className={styles.ghostBtn} type="button" onClick={() => open()} disabled={!ready}>
      Reconnect
    </button>
  );
}
// ─── Pending account mapping (shown after Plaid Link success) ────────────────

export function Settings() {
  const { token, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('banks');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState('');

  // ── Connected Plaid items ───────────────────────────────────────────────────
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [banksMsg, setBanksMsg] = useState('');
  const [reconnectState, setReconnectState] = useState<{ itemId: string; linkToken: string } | null>(null);
  const [reconnectLoading, setReconnectLoading] = useState<string | null>(null);
  const [linkingAccount, setLinkingAccount] = useState<{ id: string; name: string } | null>(null);

  // ── Actual Budget ───────────────────────────────────────────────────────
  const [actualUrl, setActualUrl] = useState('');
  const [actualPass, setActualPass] = useState('');
  const [actualSaving, setActualSaving] = useState(false);
  const [actualMsg, setActualMsg] = useState('');

  // Password change form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  // ── Schedule ───────────────────────────────────────────────────────────────
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCron, setScheduleCron] = useState('0 4 * * *');
  const [scheduleMsg, setScheduleMsg] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [scheduleLastRun, setScheduleLastRun] = useState<string | undefined>();
  const [scheduleLastResult, setScheduleLastResult] = useState<string | undefined>();

  // ── 2FA ──────────────────────────────────────────────────────────────────
  const [totpSetup, setTotpSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpMsg, setTotpMsg] = useState('');
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    if (!token) return;
    Promise.all([
      getSettings(token),
      listPlaidItems(token),
    ]).then(([s, items]) => {
      setSettings(s);
      setActualUrl(s.actual_server_url ?? '');
      setPlaidItems(items);

      // Load saved schedule settings
      setScheduleEnabled(s.schedule_enabled === 'true');
      setScheduleCron(s.schedule_cron ?? '0 4 * * *');
      setScheduleLastRun(s.schedule_last_run);
      setScheduleLastResult(s.schedule_last_result);
    }).catch(() => setLoadError('Failed to load settings'));
  }, [token]);

  const handleConnectBank = useCallback(async () => {
    if (!token) return;
    setLinkLoading(true); setBanksMsg('');
    try {
      const lt = await createLinkToken(token);
      setLinkToken(lt);
    } catch (err) {
      setBanksMsg(err instanceof Error ? err.message : 'Failed to start bank connection');
    } finally {
      setLinkLoading(false);
    }
  }, [token]);

  const handlePlaidSuccess = useCallback(async (publicToken: string) => {
    if (!token) return;
    setBanksMsg('');
    try {
      const { item, accounts } = await exchangePlaidToken(token, publicToken);
      setLinkToken(null);
      for (const a of accounts) {
        await createAccount(token, {
          name: a.official_name ?? a.name,
          plaid_item_id: item.id,
          plaid_account_id: a.account_id,
        });
      }
      const items = await listPlaidItems(token);
      setPlaidItems(items);
      setBanksMsg('Bank connected. Use “Link to Actual” to connect each account to your budget.');
    } catch (err) {
      setBanksMsg(err instanceof Error ? err.message : 'Failed to connect bank');
    }
  }, [token]);

  const handleReconnectBank = async (itemId: string) => {
    if (!token) return;
    setReconnectLoading(itemId); setBanksMsg('');
    try {
      const lt = await createReconnectLinkToken(token, itemId);
      setReconnectState({ itemId, linkToken: lt });
    } catch (err) {
      setBanksMsg(err instanceof Error ? err.message : 'Failed to start reconnection');
    } finally {
      setReconnectLoading(null);
    }
  };

  const handleReconnectSuccess = useCallback(async () => {
    if (!token) return;
    setReconnectState(null);
    const items = await listPlaidItems(token);
    setPlaidItems(items);
    setBanksMsg('Bank reconnected successfully.');
  }, [token]);

  const handleDisconnectItem = async (itemId: string, name: string) => {
    if (!token) return;
    if (!confirm(`Disconnect ${name}? This will remove all associated accounts.`)) return;
    setBanksMsg('');
    try {
      await deletePlaidItem(token, itemId);
      setPlaidItems(prev => prev.filter(i => i.id !== itemId));
      setBanksMsg(`${name} disconnected.`);
    } catch (err) {
      setBanksMsg(err instanceof Error ? err.message : 'Failed to disconnect bank');
    }
  };

  const handleDeleteAccount = async (accountId: string, plaidItemId: string) => {
    if (!token) return;
    if (!confirm('Remove this account mapping?')) return;
    setBanksMsg('');
    try {
      await deleteAccount(token, accountId);
      setPlaidItems(prev => prev.map(item =>
        item.id === plaidItemId
          ? { ...item, accounts: item.accounts.filter(a => a.id !== accountId) }
          : item,
      ));
    } catch (err) {
      setBanksMsg(err instanceof Error ? err.message : 'Failed to remove account');
    }
  };

  const handleUpdateAccount = async (accountId: string, plaidItemId: string, name: string) => {
    if (!token) return;
    setBanksMsg('');
    try {
      const existing = plaidItems.flatMap(i => i.accounts).find(a => a.id === accountId);
      await updateAccount(token, accountId, { name, actual_id: existing?.actual_id ?? '' });
      setPlaidItems(prev => prev.map(item =>
        item.id === plaidItemId
          ? { ...item, accounts: item.accounts.map(a => a.id === accountId ? { ...a, name } : a) }
          : item,
      ));
    } catch (err) {
      setBanksMsg(err instanceof Error ? err.message : 'Failed to update account');
    }
  };

  const saveActual = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setActualSaving(true); setActualMsg('');
    try {
      await saveSettings(token, {
        actual_server_url: actualUrl,
        ...(actualPass ? { actual_password: actualPass } : {}),
      });
      setActualPass('');
      setActualMsg('Saved.');
    } catch (err) { setActualMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setActualSaving(false); }
  };

  const handleSaveSchedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const expr = scheduleCron.trim();
    if (expr.split(/\s+/).length !== 5) {
      setScheduleMsg('Invalid cron expression — must have exactly 5 fields (e.g. 0 4 * * *)');
      return;
    }
    setScheduleSaving(true); setScheduleMsg('');
    try {
      await saveSettings(token, { schedule_enabled: scheduleEnabled ? 'true' : 'false', schedule_cron: expr });
      setScheduleMsg('Schedule saved.');
    } catch (err) { setScheduleMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setScheduleSaving(false); }
  };

  const handleRunNow = async () => {
    if (!token) return;
    setRunNowLoading(true); setScheduleMsg('');
    try {
      const result = await runScheduleNow(token);
      const allErrors = [...result.plaid.errors, ...result.actual.errors];
      const msg = allErrors.length > 0
        ? `Completed with errors: ${allErrors.join('; ')}`
        : `Done — fetched ${result.plaid.totalAdded}, imported ${result.actual.imported}.`;
      setScheduleMsg(msg);
      // Refresh last-run status from server
      const s = await getSettings(token);
      setScheduleLastRun(s.schedule_last_run);
      setScheduleLastResult(s.schedule_last_result);
    } catch (err) { setScheduleMsg(err instanceof Error ? err.message : 'Sync failed'); }
    finally { setRunNowLoading(false); }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (newPw !== confirmPw) { setPwMsg('New passwords do not match'); return; }
    if (newPw.length < 8) { setPwMsg('Password must be at least 8 characters'); return; }
    setPwSaving(true); setPwMsg('');
    try {
      await changePassword(token, currentPw, newPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg('Password changed successfully.');
    } catch (err) { setPwMsg(err instanceof Error ? err.message : 'Failed'); }
    finally { setPwSaving(false); }
  };

  const handleSetup2FA = async () => {
    if (!token) return;
    setTotpLoading(true); setTotpMsg('');
    try { setTotpSetup(await setup2FA(token)); }
    catch (err) { setTotpMsg(err instanceof Error ? err.message : 'Failed'); }
    finally { setTotpLoading(false); }
  };

  const handleEnable2FA = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !totpSetup) return;
    setTotpLoading(true); setTotpMsg('');
    try {
      await enable2FA(token, totpSetup.secret, totpCode);
      setSettings(s => s ? { ...s, totp_enabled: 'true' } : s);
      setTotpSetup(null); setTotpCode('');
      setTotpMsg('2FA enabled successfully.');
    } catch (err) { setTotpMsg(err instanceof Error ? err.message : 'Failed'); }
    finally { setTotpLoading(false); }
  };

  const handleDisable2FA = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setTotpLoading(true); setTotpMsg('');
    try {
      await disable2FA(token, disableCode);
      setSettings(s => s ? { ...s, totp_enabled: 'false' } : s);
      setDisableCode(''); setTotpSetup(null);
      setTotpMsg('2FA disabled.');
    } catch (err) { setTotpMsg(err instanceof Error ? err.message : 'Failed'); }
    finally { setTotpLoading(false); }
  };

  if (loadError) return <div className={styles.error}>{loadError}</div>;
  if (!settings) return <div className={styles.loading}>Loading settings…</div>;

  const has2fa = settings.totp_enabled === 'true';

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'banks' ? styles.activeTab : ''}`} onClick={() => setTab('banks')}>Banks</button>
        <button className={`${styles.tab} ${tab === 'actual' ? styles.activeTab : ''}`} onClick={() => setTab('actual')}>Actual Budget</button>
        <button className={`${styles.tab} ${tab === 'schedule' ? styles.activeTab : ''}`} onClick={() => setTab('schedule')}>Schedule</button>
        <button className={`${styles.tab} ${tab === 'security' ? styles.activeTab : ''}`} onClick={() => setTab('security')}>Security</button>
      </div>

      {/* ── Banks tab ──────────────────────────────────────────────────── */}
      {tab === 'banks' && (
        <div className={styles.banksContainer}>
          {banksMsg && <p className={banksMsg.toLowerCase().includes('fail') || banksMsg.toLowerCase().includes('error') ? styles.error : styles.success}>{banksMsg}</p>}

          {/* Connected banks list */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Connected Banks</h2>
            {plaidItems.length === 0 && (
              <p className={styles.qrInstructions}>No banks connected yet. Click below to add one.</p>
            )}
            {plaidItems.map(item => (
              <div key={item.id} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>{item.institution_name}</strong>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {reconnectState?.itemId === item.id
                      ? <ReconnectButton linkToken={reconnectState.linkToken} onSuccess={handleReconnectSuccess} />
                      : (
                        <button className={styles.ghostBtn} type="button"
                          onClick={() => void handleReconnectBank(item.id)}
                          disabled={reconnectLoading === item.id}>
                          {reconnectLoading === item.id ? 'Loading…' : 'Reconnect'}
                        </button>
                      )
                    }
                    <button className={styles.dangerGhostBtn} type="button"
                      onClick={() => handleDisconnectItem(item.id, item.institution_name)}>
                      Disconnect
                    </button>
                  </div>
                </div>
                {item.accounts.length === 0 && (
                  <p className={styles.qrInstructions} style={{ margin: 0 }}>No accounts mapped.</p>
                )}
                {item.accounts.map(acct => (
                  <AccountRow
                    key={acct.id}
                    acct={acct}
                    onUpdate={(name) => handleUpdateAccount(acct.id, item.id, name)}
                    onDelete={() => handleDeleteAccount(acct.id, item.id)}
                    onLinkToActual={() => setLinkingAccount({ id: acct.id, name: acct.name })}
                  />
                ))}
              </div>
            ))}
            <div style={{ marginTop: '0.75rem' }}>
              {linkToken
                ? <PlaidConnectButton linkToken={linkToken} onSuccess={handlePlaidSuccess} />
                : (
                  <button className={styles.saveBtn} type="button"
                    onClick={handleConnectBank} disabled={linkLoading}>
                    {linkLoading ? 'Loading…' : '+ Connect a Bank'}
                  </button>
                )
              }
            </div>
          </section>
        </div>
      )}

      {/* ── Actual Budget tab ─────────────────────────────────────────── */}
      {tab === 'actual' && (
        <form className={styles.form} onSubmit={saveActual}>
          <h2 className={styles.sectionTitle}>Actual Budget Connection</h2>
          <div className={styles.field}>
            <label className={styles.label}>Server URL</label>
            <input className={styles.input} type="url" value={actualUrl} onChange={e => setActualUrl(e.target.value)}
              placeholder="https://your-actual-server.example.com" />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <input className={styles.input} type="password" value={actualPass} onChange={e => setActualPass(e.target.value)}
              placeholder="Leave blank to keep current" autoComplete="new-password" />
          </div>
          {actualMsg && <p className={actualMsg.includes('aved') ? styles.success : styles.error}>{actualMsg}</p>}
          <button className={styles.saveBtn} type="submit" disabled={actualSaving}>{actualSaving ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {/* ── Schedule tab ─────────────────────────────────────────────── */}
      {tab === 'schedule' && (
        <div>
          <form className={styles.form} onSubmit={handleSaveSchedule}>
            <h2 className={styles.sectionTitle}>Automatic Sync Schedule</h2>
            <p className={styles.qrInstructions}>
              When enabled, the server will automatically pull from Plaid and import into Actual Budget on the schedule below.
            </p>

            <div className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem' }}>
              <input
                id="scheduleEnabled"
                type="checkbox"
                checked={scheduleEnabled}
                onChange={e => setScheduleEnabled(e.target.checked)}
                style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
              />
              <label htmlFor="scheduleEnabled" className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                Enable automatic sync
              </label>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Cron expression</label>
              <input
                className={styles.input}
                type="text"
                value={scheduleCron}
                onChange={e => setScheduleCron(e.target.value)}
                placeholder="0 4 * * *"
                spellCheck={false}
                style={{ fontFamily: 'monospace' }}
              />
              <p className={styles.hint} style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#718096' }}>
                Format: <code>minute hour day-of-month month day-of-week</code>
                <br />
                Examples: <code>0 4 * * *</code> (daily 4 AM) &nbsp;·&nbsp;
                <code>0 */2 * * *</code> (every 2 hours) &nbsp;·&nbsp;
                <code>0 9 * * 1-5</code> (weekdays 9 AM) &nbsp;·&nbsp;
                <code>*/30 * * * *</code> (every 30 min)
              </p>
            </div>

            {scheduleMsg && (
              <p className={scheduleMsg.toLowerCase().includes('error') || scheduleMsg.toLowerCase().includes('fail')
                ? styles.error : styles.success}>{scheduleMsg}</p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className={styles.saveBtn} type="submit" disabled={scheduleSaving}>
                {scheduleSaving ? 'Saving…' : 'Save Schedule'}
              </button>
              <button className={styles.ghostBtn} type="button" onClick={handleRunNow} disabled={runNowLoading}>
                {runNowLoading ? 'Running…' : 'Run Now'}
              </button>
            </div>
          </form>

          {(scheduleLastRun || scheduleLastResult) && (
            <section className={styles.section} style={{ marginTop: '1rem' }}>
              <h2 className={styles.sectionTitle}>Last Run</h2>
              {scheduleLastRun && (
                <p style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                  <strong>Time:</strong> {new Date(scheduleLastRun).toLocaleString()}
                </p>
              )}
              {scheduleLastResult && (
                <p style={{
                  fontSize: '0.875rem',
                  margin: '0.25rem 0',
                  color: scheduleLastResult.startsWith('error') ? '#c53030' : '#276749',
                }}>
                  <strong>Result:</strong> {scheduleLastResult}
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {/* ── Security tab ─────────────────────────────────────────────── */}
      {tab === 'security' && (
        <div className={styles.securityContainer}>

          {/* Change password */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Change Password</h2>
            <form className={styles.form} onSubmit={handleChangePassword}>
              <div className={styles.field}>
                <label className={styles.label}>Current Password</label>
                <input className={styles.input} type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required autoComplete="current-password" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>New Password</label>
                <input className={styles.input} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={8} required autoComplete="new-password" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Confirm New Password</label>
                <input className={styles.input} type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} minLength={8} required autoComplete="new-password" />
              </div>
              {pwMsg && <p className={pwMsg.includes('uccessfully') ? styles.success : styles.error}>{pwMsg}</p>}
              <button className={styles.saveBtn} type="submit" disabled={pwSaving}>{pwSaving ? 'Saving…' : 'Change Password'}</button>
            </form>
          </section>

          {/* 2FA */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Two-Factor Authentication</h2>
            <p className={styles.twoFactorStatus}>
              Status: <strong>{has2fa ? '✓ Enabled' : 'Disabled'}</strong>
            </p>

            {!has2fa && !totpSetup && (
              <button className={styles.saveBtn} onClick={handleSetup2FA} disabled={totpLoading} type="button">
                {totpLoading ? 'Loading…' : 'Enable 2FA'}
              </button>
            )}

            {!has2fa && totpSetup && (
              <div>
                <p className={styles.qrInstructions}>
                  Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code to confirm.
                </p>
                <img className={styles.qrCode} src={totpSetup.qrDataUrl} alt="2FA QR code" />
                <form onSubmit={handleEnable2FA} className={styles.codeForm}>
                  <input className={styles.input} type="text" inputMode="numeric" pattern="[0-9]*"
                    maxLength={6} value={totpCode} placeholder="6-digit code"
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus autoComplete="one-time-code" required />
                  <button className={styles.saveBtn} type="submit" disabled={totpLoading || totpCode.length < 6}>
                    {totpLoading ? 'Verifying…' : 'Confirm & Enable'}
                  </button>
                </form>
              </div>
            )}

            {has2fa && (
              <form onSubmit={handleDisable2FA} className={styles.codeForm}>
                <p className={styles.qrInstructions}>Enter a code from your authenticator app to disable 2FA.</p>
                <input className={styles.input} type="text" inputMode="numeric" pattern="[0-9]*"
                  maxLength={6} value={disableCode} placeholder="6-digit code"
                  onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code" required />
                <button className={styles.dangerBtn} type="submit" disabled={totpLoading || disableCode.length < 6}>
                  {totpLoading ? 'Disabling…' : 'Disable 2FA'}
                </button>
              </form>
            )}

            {totpMsg && <p className={totpMsg.includes('uccessfully') || totpMsg.includes('nabled') ? styles.success : styles.error}>{totpMsg}</p>}
          </section>

          {/* Logout */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Session</h2>
            <button className={styles.dangerBtn} onClick={logout} type="button">Log Out</button>
          </section>
        </div>
      )}

      {linkingAccount && token && (
        <LinkToActualModal
          token={token}
          account={linkingAccount}
          onClose={() => setLinkingAccount(null)}
          onSaved={async () => {
            setLinkingAccount(null);
            const items = await listPlaidItems(token);
            setPlaidItems(items);
          }}
        />
      )}
    </div>
  );
}
