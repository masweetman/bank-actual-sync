// Set env vars before module loads so the lazy PlaidApi singleton can be created
process.env['PLAID_CLIENT_ID'] ??= 'test-client-id';
process.env['PLAID_SECRET']    ??= 'test-secret';

import { vi, describe, it, expect, beforeEach } from 'vitest';

const plaidMocks = vi.hoisted(() => ({
  transactionsSync: vi.fn(),
}));

vi.mock('plaid', () => ({
  Configuration: vi.fn(),
  PlaidApi: vi.fn().mockImplementation(() => ({ transactionsSync: plaidMocks.transactionsSync })),
  PlaidEnvironments: { sandbox: 'https://sandbox.plaid.com', production: 'https://production.plaid.com' },
  Products: { Transactions: 'transactions' },
  CountryCode: { Us: 'US' },
}));

import { toInternalTransaction, syncTransactions, getPlaidErrorCode, type PlaidTransaction } from '../clients/plaidClient';

const BASE_TX: PlaidTransaction = {
  transaction_id: 'plaid-txn-001',
  account_id: 'acct-abc',
  date: '2024-06-10',
  authorized_date: '2024-06-09',
  name: 'STARBUCKS #1234',
  merchant_name: 'Starbucks',
  amount: 5.50, // positive = debit in Plaid convention
  pending: false,
  pending_transaction_id: null,
  category: ['Food and Drink', 'Coffee Shop'],
  personal_finance_category: null,
};

describe('toInternalTransaction', () => {
  it('converts Plaid positive debit (5.50) to negative cents (-550)', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.amount).toBe(-550);
  });

  it('converts Plaid negative credit (-20.00) to positive cents (2000)', () => {
    const tx = toInternalTransaction({ ...BASE_TX, amount: -20.00 }, 'Savings', 'actual-uuid');
    expect(tx.amount).toBe(2000);
  });

  it('uses merchant_name as payee when available', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.payee).toBe('Starbucks');
  });

  it('falls back to name when merchant_name is null', () => {
    const tx = toInternalTransaction({ ...BASE_TX, merchant_name: null }, 'Checking', 'actual-uuid');
    expect(tx.payee).toBe('STARBUCKS #1234');
  });

  it('uses transaction_id as the internal id', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.id).toBe('plaid-txn-001');
  });

  it('uses the date field from the PlaidTransaction as-is (authorized_date substitution happens upstream in mapPlaidTransaction)', () => {
    // toInternalTransaction receives an already-mapped PlaidTransaction where
    // the date field already reflects the authorized_date if one was present.
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.date).toBe('2024-06-10'); // BASE_TX.date
  });

  it('sets cleared=true for non-pending transactions', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.cleared).toBe(true);
  });

  it('sets cleared=false for pending transactions', () => {
    const tx = toInternalTransaction({ ...BASE_TX, pending: true }, 'Checking', 'actual-uuid');
    expect(tx.cleared).toBe(false);
  });

  it('passes through pending_transaction_id', () => {
    const tx = toInternalTransaction(
      { ...BASE_TX, pending_transaction_id: 'pending-parent-id' },
      'Checking',
      'actual-uuid',
    );
    expect(tx.pending_transaction_id).toBe('pending-parent-id');
  });

  it('passes null pending_transaction_id through', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.pending_transaction_id).toBeNull();
  });

  it('sets bank_account to the provided account name', () => {
    const tx = toInternalTransaction(BASE_TX, 'My Savings', 'actual-uuid');
    expect(tx.bank_account).toBe('My Savings');
  });

  it('sets actual_account_id to the provided value', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-xyz');
    expect(tx.actual_account_id).toBe('actual-xyz');
  });

  it('always sets status to "staged"', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.status).toBe('staged');
  });

  it('sets memo to empty string when personal_finance_category is null', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.memo).toBe('');
  });

  it('uses detailed personal_finance_category as memo when present', () => {
    const tx = toInternalTransaction(
      { ...BASE_TX, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' } },
      'Checking',
      'actual-uuid',
    );
    expect(tx.memo).toBe('FOOD_AND_DRINK_COFFEE');
  });

  it('falls back to primary category as memo when detailed is absent', () => {
    const tx = toInternalTransaction(
      { ...BASE_TX, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: '' } },
      'Checking',
      'actual-uuid',
    );
    // detailed is empty string (falsy) → falls back to primary
    expect(tx.memo).toBe('FOOD_AND_DRINK');
  });

  it('rounds fractional cents correctly', () => {
    // 1.005 * -100 = -100.5 → Math.round(-100.5) = -100 in JS (rounds towards +Infinity)
    const tx = toInternalTransaction({ ...BASE_TX, amount: 1.005 }, 'Checking', 'actual-uuid');
    expect(tx.amount).toBe(-100);
  });
});

// ─── getPlaidErrorCode ────────────────────────────────────────────────────────

describe('getPlaidErrorCode', () => {
  it('returns the error_code string from a Plaid SDK axios error', () => {
    const err = { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } };
    expect(getPlaidErrorCode(err)).toBe('ITEM_LOGIN_REQUIRED');
  });

  it('returns the mutation error code correctly', () => {
    const err = { response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } };
    expect(getPlaidErrorCode(err)).toBe('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
  });

  it('returns null for a plain Error instance', () => {
    expect(getPlaidErrorCode(new Error('network error'))).toBeNull();
  });

  it('returns null for null', () => {
    expect(getPlaidErrorCode(null)).toBeNull();
  });

  it('returns null when response.data.error_code is not a string', () => {
    const err = { response: { data: { error_code: 42 } } };
    expect(getPlaidErrorCode(err)).toBeNull();
  });

  it('returns null when there is no response property', () => {
    expect(getPlaidErrorCode({ message: 'bad' })).toBeNull();
  });
});

// ─── syncTransactions ────────────────────────────────────────────────────────

function makeSyncPage(overrides: {
  added?: object[];
  modified?: object[];
  removed?: object[];
  next_cursor?: string;
  has_more?: boolean;
} = {}) {
  return {
    data: {
      added: overrides.added ?? [],
      modified: overrides.modified ?? [],
      removed: overrides.removed ?? [],
      next_cursor: overrides.next_cursor ?? 'cursor-final',
      has_more: overrides.has_more ?? false,
    },
  };
}

describe('syncTransactions', () => {
  beforeEach(() => {
    plaidMocks.transactionsSync.mockReset();
  });

  it('returns mapped added/modified/removed and the final cursor', async () => {
    plaidMocks.transactionsSync.mockResolvedValueOnce(makeSyncPage({
      added: [{
        transaction_id: 'tx-1', account_id: 'acct-1', date: '2024-01-01',
        authorized_date: null, name: 'Coffee', merchant_name: null,
        amount: 5, pending: false, pending_transaction_id: null,
        category: null, personal_finance_category: null,
      }],
      next_cursor: 'cursor-xyz',
      has_more: false,
    }));

    const result = await syncTransactions('token', '');
    expect(result.added).toHaveLength(1);
    expect(result.added[0].transaction_id).toBe('tx-1');
    expect(result.nextCursor).toBe('cursor-xyz');
    expect(result.hasMore).toBe(false);
  });

  it('paginates until has_more is false', async () => {
    plaidMocks.transactionsSync
      .mockResolvedValueOnce(makeSyncPage({ added: [{ transaction_id: 'tx-1', account_id: 'a', date: '2024-01-01', authorized_date: null, name: 'A', merchant_name: null, amount: 1, pending: false, pending_transaction_id: null, category: null, personal_finance_category: null }], next_cursor: 'c2', has_more: true }))
      .mockResolvedValueOnce(makeSyncPage({ added: [{ transaction_id: 'tx-2', account_id: 'a', date: '2024-01-02', authorized_date: null, name: 'B', merchant_name: null, amount: 2, pending: false, pending_transaction_id: null, category: null, personal_finance_category: null }], next_cursor: 'c3', has_more: false }));

    const result = await syncTransactions('token', '');
    expect(plaidMocks.transactionsSync).toHaveBeenCalledTimes(2);
    expect(result.added).toHaveLength(2);
    expect(result.nextCursor).toBe('c3');
  });

  it('retries from the original cursor on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', async () => {
    const mutationErr = { response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } };
    plaidMocks.transactionsSync
      .mockRejectedValueOnce(mutationErr)          // attempt 1: mutation error
      .mockResolvedValueOnce(makeSyncPage({        // attempt 2: success
        added: [{ transaction_id: 'tx-ok', account_id: 'a', date: '2024-01-01', authorized_date: null, name: 'X', merchant_name: null, amount: 3, pending: false, pending_transaction_id: null, category: null, personal_finance_category: null }],
        next_cursor: 'cursor-after-retry',
        has_more: false,
      }));

    const result = await syncTransactions('token', 'original-cursor');
    expect(plaidMocks.transactionsSync).toHaveBeenCalledTimes(2);
    // Second call must use the original cursor, not a stale intermediate one
    expect(plaidMocks.transactionsSync.mock.calls[1][0]).toMatchObject({ cursor: 'original-cursor' });
    expect(result.added).toHaveLength(1);
    expect(result.nextCursor).toBe('cursor-after-retry');
  });

  it('throws after exceeding MAX_RETRIES mutation errors', async () => {
    const mutationErr = { response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } };
    plaidMocks.transactionsSync.mockRejectedValue(mutationErr);

    await expect(syncTransactions('token', '')).rejects.toThrow('max retries exceeded');
  });

  it('re-throws non-mutation errors immediately', async () => {
    plaidMocks.transactionsSync.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(syncTransactions('token', '')).rejects.toThrow('Network timeout');
    expect(plaidMocks.transactionsSync).toHaveBeenCalledTimes(1);
  });
});
