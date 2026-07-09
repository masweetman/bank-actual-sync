import { describe, it, expect } from 'vitest';
import https from 'https';
import { buildTellerAgent, toInternalTellerTransaction } from '../clients/tellerClient';
import type { TellerTransaction } from '../types';

// ─── buildTellerAgent ─────────────────────────────────────────────────────────

describe('buildTellerAgent', () => {
  it('returns an https.Agent when cert and key are provided', () => {
    const agent = buildTellerAgent('cert-pem-data', 'key-pem-data');
    expect(agent).toBeInstanceOf(https.Agent);
  });

  it('returns a plain https.Agent for sandbox (empty cert/key)', () => {
    const agent = buildTellerAgent('', '');
    expect(agent).toBeInstanceOf(https.Agent);
  });
});

// ─── toInternalTellerTransaction ─────────────────────────────────────────────

const BASE_TX: TellerTransaction = {
  id: 'txn-abc123',
  account_id: 'acct-001',
  amount: '12.50', // positive = debit in Teller convention
  date: '2024-06-15',
  description: 'AMAZON PRIME',
  details: {
    processing_status: 'complete',
    category: 'shopping',
    counterparty: { name: 'Amazon', type: 'merchant' },
  },
  status: 'posted',
  type: 'transaction',
  running_balance: null,
};

describe('toInternalTellerTransaction', () => {
  it('prefixes the transaction id with "teller_"', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.id).toBe('teller_txn-abc123');
  });

  it('converts Teller positive debit (12.50) to negative cents (-1250)', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.amount).toBe(-1250);
  });

  it('converts Teller negative credit (-50.00) to positive cents (5000)', () => {
    const tx = toInternalTellerTransaction({ ...BASE_TX, amount: '-50.00' }, 'Checking', 'actual-uuid');
    expect(tx.amount).toBe(5000);
  });

  it('uses counterparty name as payee when available', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.payee).toBe('Amazon');
  });

  it('falls back to description when counterparty name is null', () => {
    const tx = toInternalTellerTransaction(
      { ...BASE_TX, details: { ...BASE_TX.details, counterparty: { name: null, type: null } } },
      'Checking',
      'actual-uuid',
    );
    expect(tx.payee).toBe('AMAZON PRIME');
  });

  it('falls back to description when counterparty is null', () => {
    const tx = toInternalTellerTransaction(
      { ...BASE_TX, details: { ...BASE_TX.details, counterparty: null } },
      'Checking',
      'actual-uuid',
    );
    expect(tx.payee).toBe('AMAZON PRIME');
  });

  it('sets cleared=true for posted transactions', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.cleared).toBe(true);
  });

  it('sets cleared=false for pending transactions', () => {
    const tx = toInternalTellerTransaction({ ...BASE_TX, status: 'pending' }, 'Checking', 'actual-uuid');
    expect(tx.cleared).toBe(false);
  });

  it('sets bank_account to the provided account name', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'My Savings', 'actual-uuid');
    expect(tx.bank_account).toBe('My Savings');
  });

  it('sets actual_account_id to the provided value', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-xyz');
    expect(tx.actual_account_id).toBe('actual-xyz');
  });

  it('always sets status to "staged"', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.status).toBe('staged');
  });

  it('sets pending_transaction_id to null', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.pending_transaction_id).toBeNull();
  });

  it('sets the date from the transaction', () => {
    const tx = toInternalTellerTransaction(BASE_TX, 'Checking', 'actual-uuid');
    expect(tx.date).toBe('2024-06-15');
  });

  it('rounds sub-cent amounts (0.009 dollars → -1 cent)', () => {
    // Math.round(0.009 * -100) = Math.round(-0.9) = -1
    const tx = toInternalTellerTransaction({ ...BASE_TX, amount: '0.009' }, 'Checking', 'actual-uuid');
    expect(tx.amount).toBe(-1);
  });
});
