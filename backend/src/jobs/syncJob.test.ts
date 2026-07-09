import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlaidItem, TellerEnrollment, Account, Transaction, SyncResult } from '../types';

// ─── Mock all external dependencies ──────────────────────────────────────────

vi.mock('../db/plaidRepository', () => ({
  plaidRepository: { listAll: vi.fn(), getAccessToken: vi.fn(), updateCursor: vi.fn(), updateStatus: vi.fn() },
}));
vi.mock('../db/tellerRepository', () => ({
  tellerRepository: { listAll: vi.fn(), getAccessToken: vi.fn(), updateLastSynced: vi.fn() },
}));
vi.mock('../db/accountRepository', () => ({
  accountRepository: { listByItem: vi.fn(), listByEnrollment: vi.fn() },
}));
vi.mock('../db/repository', () => ({
  repository: { upsertMany: vi.fn(), deleteStaged: vi.fn(), listStaged: vi.fn(), markSynced: vi.fn() },
}));
vi.mock('../db/settingsRepository', () => ({
  settingsRepo: { get: vi.fn(() => null), set: vi.fn() },
}));
vi.mock('../clients/plaidClient', () => ({
  syncTransactions: vi.fn(),
  toInternalTransaction: vi.fn(),
  getPlaidErrorCode: vi.fn(() => null),
}));
vi.mock('../clients/tellerClient', () => ({
  buildTellerAgent: vi.fn(() => ({})),
  listTellerTransactions: vi.fn(),
  toInternalTellerTransaction: vi.fn(),
}));
vi.mock('../clients/actualClient', () => ({
  importStagedTransactions: vi.fn(),
}));

import { runPlaidSync, runTellerSync, runFullSync } from '../jobs/syncJob';
import { plaidRepository } from '../db/plaidRepository';
import { tellerRepository } from '../db/tellerRepository';
import { accountRepository } from '../db/accountRepository';
import { repository } from '../db/repository';
import { syncTransactions, toInternalTransaction, getPlaidErrorCode } from '../clients/plaidClient';
import { importStagedTransactions } from '../clients/actualClient';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlaidItem(overrides: Partial<PlaidItem> = {}): PlaidItem {
  return { id: 'item-1', item_id: 'pi-1', institution_id: 'ins-1', institution_name: 'Bank', cursor: '', created_at: '', ...overrides };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acct-1', name: 'Checking', provider: 'plaid',
    plaid_item_id: 'item-1', plaid_account_id: 'plaid-acct-1',
    teller_enrollment_id: null, teller_account_id: null,
    actual_id: 'actual-1', actual_server_url: '', actual_sync_id: '', created_at: '',
    ...overrides,
  };
}

function makeInternalTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1', bank_account: 'Checking', actual_account_id: 'actual-1',
    date: '2024-06-01', amount: -500, payee: 'Coffee', memo: '', cleared: true,
    pending_transaction_id: null, status: 'staged', fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── runPlaidSync ─────────────────────────────────────────────────────────────

describe('runPlaidSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero totals when no Plaid items are connected', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([]);
    const result = await runPlaidSync();
    expect(result.totalAdded).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(repository.upsertMany).not.toHaveBeenCalled();
  });

  it('records an error when the access token is missing for an item', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue(null);
    const result = await runPlaidSync();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Bank');
    expect(result.totalAdded).toBe(0);
  });

  it('upserts mapped transactions and advances the cursor on success', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok-abc');
    vi.mocked(accountRepository.listByItem).mockReturnValue([makeAccount()]);
    vi.mocked(syncTransactions).mockResolvedValue({
      added: [{
        transaction_id: 'tx-1', account_id: 'plaid-acct-1', date: '2024-06-01',
        authorized_date: null, name: 'Coffee', merchant_name: null, amount: 5,
        pending: false, pending_transaction_id: null, category: null,
      }],
      modified: [],
      removed: [],
      nextCursor: 'cursor-new',
      hasMore: false,
    });
    vi.mocked(toInternalTransaction).mockReturnValue(makeInternalTx());

    const result = await runPlaidSync();
    expect(repository.upsertMany).toHaveBeenCalledOnce();
    expect(plaidRepository.updateCursor).toHaveBeenCalledWith('item-1', 'cursor-new');
    expect(result.totalAdded).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('skips transactions for accounts not in the account map', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok');
    vi.mocked(accountRepository.listByItem).mockReturnValue([]); // no mapped accounts
    vi.mocked(syncTransactions).mockResolvedValue({
      added: [{ transaction_id: 'tx-1', account_id: 'unmapped-acct', date: '2024-06-01',
        authorized_date: null, name: 'Shop', merchant_name: null, amount: 10,
        pending: false, pending_transaction_id: null, category: null }],
      modified: [],
      removed: [],
      nextCursor: 'c2',
      hasMore: false,
    });

    const result = await runPlaidSync();
    expect(repository.upsertMany).not.toHaveBeenCalled();
    expect(result.totalAdded).toBe(0);
  });

  it('records an error when syncTransactions throws', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok');
    vi.mocked(accountRepository.listByItem).mockReturnValue([makeAccount()]);
    vi.mocked(syncTransactions).mockRejectedValue(new Error('Plaid API unavailable'));

    const result = await runPlaidSync();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Plaid API unavailable');
    expect(result.totalAdded).toBe(0);
  });

  it('processes removed transaction ids by calling deleteStaged', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok');
    vi.mocked(accountRepository.listByItem).mockReturnValue([makeAccount()]);
    vi.mocked(syncTransactions).mockResolvedValue({
      added: [], modified: [], removed: ['removed-tx-id'],
      nextCursor: 'c', hasMore: false,
    });

    await runPlaidSync();
    expect(repository.deleteStaged).toHaveBeenCalledWith('removed-tx-id');
  });

  it('sets status to "good" after a successful sync', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok-abc');
    vi.mocked(accountRepository.listByItem).mockReturnValue([makeAccount()]);
    vi.mocked(syncTransactions).mockResolvedValue({
      added: [], modified: [], removed: [],
      nextCursor: 'cursor-new', hasMore: false,
    });

    await runPlaidSync();
    expect(plaidRepository.updateStatus).toHaveBeenCalledWith('item-1', 'good');
  });

  it('sets status to "login_required" when ITEM_LOGIN_REQUIRED error is detected', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok');
    vi.mocked(accountRepository.listByItem).mockReturnValue([makeAccount()]);
    vi.mocked(syncTransactions).mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));
    vi.mocked(getPlaidErrorCode).mockReturnValue('ITEM_LOGIN_REQUIRED');

    const result = await runPlaidSync();
    expect(plaidRepository.updateStatus).toHaveBeenCalledWith('item-1', 'login_required');
    expect(result.errors).toHaveLength(1);
  });

  it('does not call updateStatus to login_required for non-auth errors', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([makePlaidItem()]);
    vi.mocked(plaidRepository.getAccessToken).mockReturnValue('tok');
    vi.mocked(accountRepository.listByItem).mockReturnValue([makeAccount()]);
    vi.mocked(syncTransactions).mockRejectedValue(new Error('Network timeout'));
    vi.mocked(getPlaidErrorCode).mockReturnValue(null);

    await runPlaidSync();
    expect(plaidRepository.updateStatus).not.toHaveBeenCalledWith('item-1', 'login_required');
  });
});

// ─── runTellerSync ────────────────────────────────────────────────────────────

describe('runTellerSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero totals when no Teller enrollments exist', async () => {
    vi.mocked(tellerRepository.listAll).mockReturnValue([]);
    const result = await runTellerSync();
    expect(result.totalAdded).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── runFullSync ──────────────────────────────────────────────────────────────

describe('runFullSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns combined plaid, teller, and actual result objects', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([]);
    vi.mocked(tellerRepository.listAll).mockReturnValue([]);
    vi.mocked(repository.listStaged).mockReturnValue([]);

    const result = await runFullSync();
    expect(result).toHaveProperty('plaid');
    expect(result).toHaveProperty('teller');
    expect(result).toHaveProperty('actual');
  });

  it('imports staged transactions and marks them synced', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([]);
    vi.mocked(tellerRepository.listAll).mockReturnValue([]);

    const staged = [makeInternalTx({ id: 'tx-staged-1' }), makeInternalTx({ id: 'tx-staged-2' })];
    vi.mocked(repository.listStaged).mockReturnValue(staged);

    const actualResult: SyncResult = { imported: 2, skipped: 0, errors: [], failedIds: [] };
    vi.mocked(importStagedTransactions).mockResolvedValue(actualResult);

    await runFullSync();
    expect(importStagedTransactions).toHaveBeenCalledWith(staged);
    expect(repository.markSynced).toHaveBeenCalledWith('tx-staged-1');
    expect(repository.markSynced).toHaveBeenCalledWith('tx-staged-2');
  });

  it('does not markSynced for transactions in failedIds', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([]);
    vi.mocked(tellerRepository.listAll).mockReturnValue([]);

    const staged = [makeInternalTx({ id: 'tx-ok' }), makeInternalTx({ id: 'tx-fail' })];
    vi.mocked(repository.listStaged).mockReturnValue(staged);

    const actualResult: SyncResult = { imported: 1, skipped: 0, errors: ['err'], failedIds: ['tx-fail'] };
    vi.mocked(importStagedTransactions).mockResolvedValue(actualResult);

    await runFullSync();
    expect(repository.markSynced).toHaveBeenCalledWith('tx-ok');
    expect(repository.markSynced).not.toHaveBeenCalledWith('tx-fail');
  });

  it('skips importStagedTransactions when there are no staged transactions', async () => {
    vi.mocked(plaidRepository.listAll).mockReturnValue([]);
    vi.mocked(tellerRepository.listAll).mockReturnValue([]);
    vi.mocked(repository.listStaged).mockReturnValue([]);

    await runFullSync();
    expect(importStagedTransactions).not.toHaveBeenCalled();
  });
});
