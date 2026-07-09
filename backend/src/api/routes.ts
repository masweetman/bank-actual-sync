import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { repository } from '../db/repository';
import { settingsRepo } from '../db/settingsRepository';
import { accountRepository } from '../db/accountRepository';
import { plaidRepository } from '../db/plaidRepository';
import { tellerRepository } from '../db/tellerRepository';
import { importStagedTransactions, fetchActualAccounts } from '../clients/actualClient';
import { createLinkToken, createUpdateLinkToken, exchangePublicToken, removeItem } from '../clients/plaidClient';
import { buildTellerAgent, listTellerAccounts } from '../clients/tellerClient';
import { requireAuth, getJwtSecret } from './auth.middleware';
import { runFullSync } from '../jobs/syncJob';
import { restartScheduler } from '../jobs/scheduler';
import cron from 'node-cron';

const router = Router();
const BCRYPT_ROUNDS = 12;
const TEMP_TOKEN_TTL = '5m';
const FULL_TOKEN_TTL = '12h';

// ─── Auth Status ─────────────────────────────────────────────────────────────

/** Public — tells the frontend whether first-run setup is needed */
router.get('/auth/status', (_req: Request, res: Response): void => {
  res.json({
    setup_required: !settingsRepo.has('admin_password_hash'),
    has_2fa: settingsRepo.get('totp_enabled') === 'true',
  });
});

// ─── First-run Setup ──────────────────────────────────────────────────────────

router.post('/setup', async (req: Request, res: Response): Promise<void> => {
  if (settingsRepo.has('admin_password_hash')) {
    res.status(403).json({ error: 'Admin password already set' });
    return;
  }
  const { password } = req.body as { password?: string };
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  settingsRepo.set('admin_password_hash', hash);
  res.json({ success: true });
});

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { password } = req.body as { password?: string };
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Password required' });
    return;
  }

  const hash = settingsRepo.get('admin_password_hash');
  if (!hash) {
    res.status(403).json({ error: 'App not set up yet' });
    return;
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const secret = getJwtSecret();
  const has2fa = settingsRepo.get('totp_enabled') === 'true';

  if (has2fa) {
    // Issue short-lived pre-2fa token; client must verify TOTP to get full token
    const tempToken = jwt.sign({ sub: 'admin', stage: 'pre-2fa' }, secret, { expiresIn: TEMP_TOKEN_TTL });
    res.json({ requires2fa: true, tempToken });
    return;
  }

  const token = jwt.sign({ sub: 'admin', stage: 'authenticated' }, secret, { expiresIn: FULL_TOKEN_TTL });
  res.json({ token });
});

// ─── 2FA Verification (during login) ─────────────────────────────────────────

router.post('/auth/verify-2fa', (req: Request, res: Response): void => {
  const { tempToken, code } = req.body as { tempToken?: string; code?: string };
  if (!tempToken || !code) {
    res.status(400).json({ error: 'tempToken and code are required' });
    return;
  }

  const secret = getJwtSecret();
  let payload: { sub: string; stage?: string };
  try {
    payload = jwt.verify(tempToken, secret) as typeof payload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired temp token' });
    return;
  }

  if (payload.stage !== 'pre-2fa') {
    res.status(400).json({ error: 'Invalid token stage' });
    return;
  }

  const totpSecret = settingsRepo.get('totp_secret');
  if (!totpSecret) {
    res.status(500).json({ error: '2FA not configured' });
    return;
  }

  if (!authenticator.check(code, totpSecret)) {
    res.status(401).json({ error: 'Invalid authentication code' });
    return;
  }

  const token = jwt.sign({ sub: 'admin', stage: 'authenticated' }, secret, { expiresIn: FULL_TOKEN_TTL });
  res.json({ token });
});

// ─── Change Password ──────────────────────────────────────────────────────────

router.post('/auth/change-password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const hash = settingsRepo.get('admin_password_hash');
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  settingsRepo.set('admin_password_hash', await bcrypt.hash(newPassword, BCRYPT_ROUNDS));
  res.json({ success: true });
});

// ─── 2FA Setup ────────────────────────────────────────────────────────────────

router.get('/auth/2fa/setup', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const totpSecret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri('admin', 'Bank Sync', totpSecret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  res.json({ qrDataUrl, secret: totpSecret });
});

router.post('/auth/2fa/enable', requireAuth, (req: Request, res: Response): void => {
  const { secret, code } = req.body as { secret?: string; code?: string };
  if (!secret || !code) {
    res.status(400).json({ error: 'secret and code are required' });
    return;
  }
  if (!authenticator.check(code, secret)) {
    res.status(401).json({ error: 'Invalid authentication code — check your authenticator app and try again' });
    return;
  }
  settingsRepo.set('totp_secret', secret);
  settingsRepo.set('totp_enabled', 'true');
  res.json({ success: true });
});

router.post('/auth/2fa/disable', requireAuth, (req: Request, res: Response): void => {
  const { code } = req.body as { code?: string };
  const totpSecret = settingsRepo.get('totp_secret');
  if (!totpSecret) {
    res.status(400).json({ error: '2FA is not enabled' });
    return;
  }
  if (!code || !authenticator.check(code, totpSecret)) {
    res.status(401).json({ error: 'Invalid authentication code' });
    return;
  }
  settingsRepo.set('totp_enabled', 'false');
  settingsRepo.delete('totp_secret');
  res.json({ success: true });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

router.get('/settings', requireAuth, (_req: Request, res: Response): void => {
  const pub = settingsRepo.getPublic();
  // Expose whether Teller cert+key are configured without revealing the PEM content
  pub['teller_configured'] = (
    settingsRepo.has('teller_cert') && settingsRepo.has('teller_key')
  ) ? 'true' : 'false';
  res.json(pub);
});

router.put('/settings', requireAuth, (req: Request, res: Response): void => {
  const ALLOWED_PLAIN = [
    'actual_server_url',
    'actual_budget_id',
    'schedule_enabled',
    'schedule_cron',
    'teller_application_id',
    'teller_env',
    'plaid_days_requested',
  ];
  const ALLOWED_SECRET = ['actual_password', 'teller_cert', 'teller_key'];

  const body = req.body as Record<string, unknown>;

  // Validate cron expression before persisting anything
  if (typeof body['schedule_cron'] === 'string' && !cron.validate(body['schedule_cron'] as string)) {
    res.status(400).json({ error: 'Invalid cron expression' });
    return;
  }

  // Validate plaid_days_requested before persisting
  if (typeof body['plaid_days_requested'] === 'string') {
    const days = parseInt(body['plaid_days_requested'] as string, 10);
    if (isNaN(days) || days < 1 || days > 730) {
      res.status(400).json({ error: 'plaid_days_requested must be a whole number between 1 and 730' });
      return;
    }
  }

  let scheduleChanged = false;
  for (const key of ALLOWED_PLAIN) {
    if (typeof body[key] === 'string') {
      settingsRepo.set(key, body[key] as string);
      if (key === 'schedule_enabled' || key === 'schedule_cron') {
        scheduleChanged = true;
      }
    }
  }
  // Only update secret fields if a non-empty value is provided
  for (const key of ALLOWED_SECRET) {
    if (typeof body[key] === 'string' && (body[key] as string).length > 0) {
      settingsRepo.set(key, body[key] as string);
    }
  }

  if (scheduleChanged) {
    restartScheduler();
  }

  res.json({ success: true });
});

// ─── Schedule ─────────────────────────────────────────────────────────────────

/** Immediately runs a full Plaid → Actual sync outside the normal schedule. */
router.post('/schedule/run-now', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { plaid, teller, actual } = await runFullSync();
    res.json({ plaid, teller, actual });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

// ─── Plaid Items ──────────────────────────────────────────────────────────────

/** Create a Link token so the frontend can open Plaid Link */
router.post('/plaid/link-token', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const daysRaw = settingsRepo.get('plaid_days_requested');
    const daysNum = daysRaw ? parseInt(daysRaw, 10) : NaN;
    const daysRequested = !isNaN(daysNum) && daysNum >= 1 && daysNum <= 730 ? daysNum : undefined;
    const linkToken = await createLinkToken('admin', daysRequested);
    res.json({ link_token: linkToken });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create link token' });
  }
});

/** Create an update-mode Link token so the frontend can re-authenticate an existing Plaid Item */
router.post('/plaid/reconnect-link-token', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { item_id } = req.body as { item_id?: string };
  if (!item_id || typeof item_id !== 'string') {
    res.status(400).json({ error: 'item_id is required' });
    return;
  }
  const accessToken = plaidRepository.getAccessToken(item_id);
  if (!accessToken) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  try {
    const linkToken = await createUpdateLinkToken(accessToken);
    res.json({ link_token: linkToken });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create reconnect link token' });
  }
});

/**
 * Exchange a public_token from Plaid Link.
 * Saves the item + access_token, returns discovered accounts for the user to map.
 *
 * Accepts an optional `institution_id` from the onSuccess metadata to detect
 * duplicates before exchanging the token (avoids unnecessary Plaid billing).
 * Returns 409 with `existing_item_id` when the institution is already connected.
 */
router.post('/plaid/exchange-token', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { public_token, institution_id } = req.body as { public_token?: string; institution_id?: string };
  if (!public_token || typeof public_token !== 'string') {
    res.status(400).json({ error: 'public_token is required' });
    return;
  }

  // Primary duplicate check: institution_id from onSuccess metadata (no token exchange needed)
  if (institution_id && typeof institution_id === 'string') {
    const existing = plaidRepository.getByInstitutionId(institution_id);
    if (existing) {
      res.status(409).json({
        error: 'This institution is already connected. Use Reconnect to re-authenticate.',
        existing_item_id: existing.id,
      });
      return;
    }
  }

  try {
    const result = await exchangePublicToken(public_token);

    // Fallback duplicate check: institution_id from the newly exchanged item
    if (result.institution_id) {
      const existing = plaidRepository.getByInstitutionId(result.institution_id);
      if (existing) {
        // Remove the duplicate Item at Plaid to avoid billing, then reject
        try {
          await removeItem(result.access_token);
        } catch (cleanupErr) {
          console.warn('[plaid] failed to remove duplicate item:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
        }
        res.status(409).json({
          error: 'This institution is already connected. Use Reconnect to re-authenticate.',
          existing_item_id: existing.id,
        });
        return;
      }
    }

    const item = plaidRepository.create({
      item_id: result.item_id,
      institution_id: result.institution_id,
      institution_name: result.institution_name,
      access_token: result.access_token,
    });
    res.status(201).json({ item, accounts: result.accounts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to exchange token' });
  }
});

/** List all connected Plaid items along with their mapped accounts */
router.get('/plaid/items', requireAuth, (_req: Request, res: Response): void => {
  const items = plaidRepository.listAll();
  const itemsWithAccounts = items.map(item => ({
    ...item,
    accounts: accountRepository.listByItem(item.id),
  }));
  res.json(itemsWithAccounts);
});

// ─── Teller Enrollments ──────────────────────────────────────────────────────

/**
 * Save a new Teller enrollment after the user completes Teller Connect.
 * Body: { accessToken, enrollmentId, institutionName }
 */
router.post('/teller/enrollments', requireAuth, (req: Request, res: Response): void => {
  const { accessToken, enrollmentId, institutionName } = req.body as Record<string, unknown>;
  if (!accessToken || typeof accessToken !== 'string' ||
      !enrollmentId || typeof enrollmentId !== 'string') {
    res.status(400).json({ error: 'accessToken and enrollmentId are required strings' });
    return;
  }
  try {
    const enrollment = tellerRepository.create({
      enrollment_id: enrollmentId,
      institution_name: typeof institutionName === 'string' ? institutionName : enrollmentId,
      access_token: accessToken,
    });
    res.status(201).json(enrollment);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save enrollment' });
  }
});

/** List all Teller enrollments, each with their live accounts fetched from Teller */
router.get('/teller/enrollments', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const enrollments = tellerRepository.listAll();
  const cert = settingsRepo.get('teller_cert') ?? '';
  const key  = settingsRepo.get('teller_key')  ?? '';
  const agent = buildTellerAgent(cert, key);

  const results = await Promise.all(enrollments.map(async enrollment => {
    const accessToken = tellerRepository.getAccessToken(enrollment.id);
    let tellerAccounts: unknown[] = [];
    if (accessToken) {
      try {
        tellerAccounts = await listTellerAccounts(accessToken, agent);
      } catch (err) {
        console.warn(`[teller] failed to fetch accounts for ${enrollment.institution_name}:`, err instanceof Error ? err.message : err);
      }
    }
    return {
      ...enrollment,
      accounts: accountRepository.listByEnrollment(enrollment.id),
      tellerAccounts,
    };
  }));

  res.json(results);
});

/** Remove a Teller enrollment (cascades to mapped accounts) */
router.delete('/teller/enrollments/:id', requireAuth, (req: Request, res: Response): void => {
  const enrollment = tellerRepository.getById(req.params.id);
  if (!enrollment) {
    res.status(404).json({ error: 'Enrollment not found' });
    return;
  }
  tellerRepository.delete(req.params.id);
  res.json({ success: true });
});

/** Remove a Plaid item (revokes access token + cascades to accounts in DB) */
router.delete('/plaid/items/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const accessToken = plaidRepository.getAccessToken(req.params.id);
  if (!accessToken) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  try {
    await removeItem(accessToken);
  } catch (err) {
    // Log but don't block DB cleanup if Plaid item was already removed
    console.warn('[plaid] itemRemove warning:', err instanceof Error ? err.message : err);
  }
  plaidRepository.delete(req.params.id);
  res.json({ success: true });
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

router.get('/accounts', requireAuth, (_req: Request, res: Response): void => {
  res.json(accountRepository.listAll());
});

router.post('/accounts', requireAuth, (req: Request, res: Response): void => {
  const { name, plaid_item_id, plaid_account_id, teller_enrollment_id, teller_account_id, actual_id, actual_sync_id } = req.body as Record<string, unknown>;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is a required string' });
    return;
  }

  // Teller account
  if (typeof teller_enrollment_id === 'string' && typeof teller_account_id === 'string') {
    const account = accountRepository.createTeller({
      name,
      teller_enrollment_id,
      teller_account_id,
      actual_id:     typeof actual_id     === 'string' ? actual_id     : '',
      actual_sync_id: typeof actual_sync_id === 'string' ? actual_sync_id : undefined,
    });
    res.status(201).json(account);
    return;
  }

  // Plaid account
  if (typeof plaid_item_id !== 'string' || typeof plaid_account_id !== 'string') {
    res.status(400).json({ error: 'Either (plaid_item_id + plaid_account_id) or (teller_enrollment_id + teller_account_id) are required' });
    return;
  }
  const account = accountRepository.createPlaid({
    name, plaid_item_id, plaid_account_id,
    actual_id:     typeof actual_id     === 'string' ? actual_id     : '',
    actual_sync_id: typeof actual_sync_id === 'string' ? actual_sync_id : undefined,
  });
  res.status(201).json(account);
});

router.put('/accounts/:id', requireAuth, (req: Request, res: Response): void => {
  const { name, actual_id, actual_sync_id } = req.body as Record<string, unknown>;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is a required string' });
    return;
  }
  accountRepository.update(req.params.id, {
    name,
    actual_id: typeof actual_id === 'string' ? actual_id : undefined,
    actual_sync_id: typeof actual_sync_id === 'string' ? actual_sync_id : undefined,
  });
  res.json({ success: true });
});

router.delete('/accounts/:id', requireAuth, (req: Request, res: Response): void => {
  accountRepository.delete(req.params.id);
  res.json({ success: true });
});

// ─── Actual Budget ────────────────────────────────────────────────────────────

/** Fetch available accounts from an Actual Budget server (for linking) */
router.post('/actual/accounts', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { syncId } = req.body as Record<string, unknown>;
  if (!syncId || typeof syncId !== 'string') {
    res.status(400).json({ error: 'syncId is required' });
    return;
  }
  try {
    const accounts = await fetchActualAccounts(syncId);
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch Actual accounts' });
  }
});

// ─── Transactions ─────────────────────────────────────────────────────────────

router.get('/transactions', requireAuth, (_req: Request, res: Response): void => {
  res.json(repository.listStaged());
});

router.get('/transactions/synced', requireAuth, (_req: Request, res: Response): void => {
  res.json(repository.listSynced());
});

router.patch('/transactions/:id/exclude', requireAuth, (req: Request, res: Response): void => {
  repository.markExcluded(req.params.id);
  res.json({ success: true });
});

router.patch('/transactions/:id/include', requireAuth, (req: Request, res: Response): void => {
  repository.markStaged(req.params.id);
  res.json({ success: true });
});

router.patch('/transactions/:id/unstage', requireAuth, (req: Request, res: Response): void => {
  repository.markStaged(req.params.id);
  res.json({ success: true });
});

router.post('/sync-to-actual', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const staged = repository.listStaged();
    if (staged.length === 0) {
      res.json({ imported: 0, skipped: 0, errors: [] });
      return;
    }
    const result = await importStagedTransactions(staged);
    for (const t of staged) {
      if (!result.failedIds.includes(t.id)) {
        repository.markSynced(t.id);
      }
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;

