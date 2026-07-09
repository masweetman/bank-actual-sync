import { describe, it, expect } from 'vitest';
import { toInternalTransaction, type PlaidTransaction } from '../clients/plaidClient';

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

  it('sets memo to empty string', () => {
    const tx = toInternalTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.memo).toBe('');
  });

  it('rounds fractional cents correctly', () => {
    // 1.005 * -100 = -100.5 → Math.round(-100.5) = -100 in JS (rounds towards +Infinity)
    const tx = toInternalTransaction({ ...BASE_TX, amount: 1.005 }, 'Checking', 'actual-uuid');
    expect(tx.amount).toBe(-100);
  });
});
