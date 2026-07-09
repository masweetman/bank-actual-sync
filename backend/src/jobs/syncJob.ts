import { plaidRepository } from '../db/plaidRepository';
import { tellerRepository } from '../db/tellerRepository';
import { accountRepository } from '../db/accountRepository';
import { repository } from '../db/repository';
import { settingsRepo } from '../db/settingsRepository';
import { syncTransactions, toInternalTransaction, getPlaidErrorCode } from '../clients/plaidClient';
import { buildTellerAgent, listTellerTransactions, toInternalTellerTransaction } from '../clients/tellerClient';
import { importStagedTransactions } from '../clients/actualClient';
import type { SyncResult } from '../types';

export interface PlaidSyncResult {
  totalAdded: number;
  errors: string[];
}

export interface TellerSyncResult {
  totalAdded: number;
  errors: string[];
}

export interface FullSyncResult {
  plaid: PlaidSyncResult;
  teller: TellerSyncResult;
  actual: SyncResult;
}

/**
 * Fetches new/modified transactions from all connected Plaid items and
 * upserts them into the local DB as 'staged'. Returns totals and any errors.
 */
export async function runPlaidSync(): Promise<PlaidSyncResult> {
  const items = plaidRepository.listAll();
  let totalAdded = 0;
  const errors: string[] = [];

  for (const item of items) {
    const accessToken = plaidRepository.getAccessToken(item.id);
    if (!accessToken) {
      errors.push(`Missing access token for ${item.institution_name}`);
      continue;
    }

    try {
      const syncResult = await syncTransactions(accessToken, item.cursor);

      const pendingFromPlaid = syncResult.added.filter(t => t.pending);
      console.log(`[syncJob] ${item.institution_name}: ${syncResult.added.length} added, ${syncResult.modified.length} modified, ${syncResult.removed.length} removed, ${pendingFromPlaid.length} pending`);
      if (pendingFromPlaid.length > 0) {
        console.log('[syncJob] pending tx ids:', pendingFromPlaid.map(t => t.transaction_id));
      }

      const accounts = accountRepository.listByItem(item.id);
      const accountMap = new Map(accounts.map(a => [a.plaid_account_id, a]));

      const txsToUpsert = [
        ...syncResult.added,
        ...syncResult.modified,
      ]
        .filter(t => accountMap.has(t.account_id))
        .map(t => {
          const acct = accountMap.get(t.account_id)!;
          return toInternalTransaction(t, acct.name, acct.actual_id);
        });

      const pendingToUpsert = txsToUpsert.filter(t => !t.cleared);
      console.log(`[syncJob] ${item.institution_name}: upserting ${txsToUpsert.length} txs (${pendingToUpsert.length} pending/uncleared)`);

      if (txsToUpsert.length > 0) {
        repository.upsertMany(txsToUpsert);
        totalAdded += txsToUpsert.length;
      }

      for (const txId of syncResult.removed) {
        try { repository.deleteStaged(txId); } catch { /* not found or already synced */ }
      }

      plaidRepository.updateCursor(item.id, syncResult.nextCursor);
      plaidRepository.updateStatus(item.id, 'good');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[syncJob] error for ${item.institution_name}:`, err);
      if (getPlaidErrorCode(err) === 'ITEM_LOGIN_REQUIRED') {
        plaidRepository.updateStatus(item.id, 'login_required');
      }
      errors.push(`${item.institution_name}: ${msg}`);
    }
  }

  return { totalAdded, errors };
}

/**
 * Fetches new transactions from all connected Teller enrollments and
 * upserts them into the local DB as 'staged'. Returns totals and any errors.
 */
export async function runTellerSync(): Promise<TellerSyncResult> {
  const enrollments = tellerRepository.listAll();
  let totalAdded = 0;
  const errors: string[] = [];

  if (enrollments.length === 0) {
    return { totalAdded: 0, errors: [] };
  }

  const cert = settingsRepo.get('teller_cert') ?? '';
  const key  = settingsRepo.get('teller_key')  ?? '';
  const agent = buildTellerAgent(cert, key);

  for (const enrollment of enrollments) {
    const accessToken = tellerRepository.getAccessToken(enrollment.id);
    if (!accessToken) {
      errors.push(`Missing access token for ${enrollment.institution_name}`);
      continue;
    }

    const mappedAccounts = accountRepository.listByEnrollment(enrollment.id);
    if (mappedAccounts.length === 0) continue;

    // Use last_synced_at - 10 days as start date (Teller recommendation for pending→posted)
    let startDate: string;
    if (enrollment.last_synced_at) {
      const d = new Date(enrollment.last_synced_at);
      d.setDate(d.getDate() - 10);
      startDate = d.toISOString().slice(0, 10);
    } else {
      // First sync: go back 30 days
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startDate = d.toISOString().slice(0, 10);
    }

    for (const acct of mappedAccounts) {
      if (!acct.teller_account_id || !acct.actual_id) continue;
      try {
        const txs = await listTellerTransactions(accessToken, acct.teller_account_id, startDate, agent);
        const pendingCount = txs.filter(t => t.status === 'pending').length;
        const postedCount  = txs.filter(t => t.status === 'posted').length;
        console.log(`[syncJob/teller] ${enrollment.institution_name} / ${acct.name}: ${txs.length} transactions (${postedCount} posted, ${pendingCount} pending)`);
        if (txs.length > 0) {
          const internal = txs.map(tx => toInternalTellerTransaction(tx, acct.name, acct.actual_id));
          repository.upsertMany(internal);
          totalAdded += internal.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[syncJob/teller] error for ${enrollment.institution_name} / ${acct.name}:`, err);
        errors.push(`${enrollment.institution_name} / ${acct.name}: ${msg}`);
      }
    }

    tellerRepository.updateLastSynced(enrollment.id, new Date().toISOString());
  }

  return { totalAdded, errors };
}

/**
 * Runs a complete sync: fetches from Plaid and Teller, then imports all staged
 * transactions into Actual Budget and marks them synced.
 */
export async function runFullSync(): Promise<FullSyncResult> {
  const [plaid, teller] = await Promise.all([runPlaidSync(), runTellerSync()]);

  const staged = repository.listStaged();
  let actual: SyncResult = { imported: 0, skipped: 0, errors: [], failedIds: [] };

  if (staged.length > 0) {
    actual = await importStagedTransactions(staged);
    for (const t of staged) {
      if (!actual.failedIds.includes(t.id)) {
        repository.markSynced(t.id);
      }
    }
  }

  return { plaid, teller, actual };
}
