import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema';
import { accountRepository } from '../db/accountRepository';
import { plaidRepository } from '../db/plaidRepository';
import { tellerRepository } from '../db/tellerRepository';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.exec('DELETE FROM accounts');
  db.exec('DELETE FROM plaid_items');
  db.exec('DELETE FROM teller_enrollments');
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function createPlaidItem(suffix = '1') {
  return plaidRepository.create({
    item_id: `item-${suffix}`,
    institution_id: `ins-${suffix}`,
    institution_name: `Bank ${suffix}`,
    access_token: `token-${suffix}`,
  });
}

function createTellerEnrollment(suffix = '1') {
  return tellerRepository.create({
    enrollment_id: `enr-${suffix}`,
    institution_name: `Teller Bank ${suffix}`,
    access_token: `teller-token-${suffix}`,
  });
}

// ─── Plaid accounts ───────────────────────────────────────────────────────────

describe('accountRepository (Plaid)', () => {
  it('creates a Plaid account with provider=plaid', () => {
    const item = createPlaidItem();
    const account = accountRepository.createPlaid({
      name: 'Checking',
      plaid_item_id: item.id,
      plaid_account_id: 'plaid-acct-001',
      actual_id: 'actual-uuid-1',
      actual_sync_id: 'sync-uuid-1',
    });
    expect(account.provider).toBe('plaid');
    expect(account.name).toBe('Checking');
    expect(account.plaid_item_id).toBe(item.id);
  });

  it('listAll returns the created account', () => {
    const item = createPlaidItem();
    accountRepository.createPlaid({
      name: 'Savings',
      plaid_item_id: item.id,
      plaid_account_id: 'plaid-acct-002',
      actual_id: 'actual-uuid-2',
    });
    expect(accountRepository.listAll()).toHaveLength(1);
  });

  it('listByItem returns only accounts for a given Plaid item', () => {
    const item1 = createPlaidItem('A');
    const item2 = createPlaidItem('B');
    accountRepository.createPlaid({ name: 'A Checking', plaid_item_id: item1.id, plaid_account_id: 'pa1', actual_id: 'a1' });
    accountRepository.createPlaid({ name: 'B Checking', plaid_item_id: item2.id, plaid_account_id: 'pa2', actual_id: 'a2' });
    expect(accountRepository.listByItem(item1.id)).toHaveLength(1);
    expect(accountRepository.listByItem(item1.id)[0].name).toBe('A Checking');
  });

  it('cascades delete when the parent Plaid item is deleted', () => {
    const item = createPlaidItem('cascade');
    accountRepository.createPlaid({ name: 'Cascade Account', plaid_item_id: item.id, plaid_account_id: 'pa3', actual_id: 'a3' });
    plaidRepository.delete(item.id);
    expect(accountRepository.listAll()).toHaveLength(0);
  });
});

// ─── Teller accounts ──────────────────────────────────────────────────────────

describe('accountRepository (Teller)', () => {
  it('creates a Teller account with provider=teller', () => {
    const enrollment = createTellerEnrollment();
    const account = accountRepository.createTeller({
      name: 'Teller Checking',
      teller_enrollment_id: enrollment.id,
      teller_account_id: 'teller-acct-001',
      actual_id: 'actual-uuid-t1',
      actual_sync_id: 'sync-uuid-t1',
    });
    expect(account.provider).toBe('teller');
    expect(account.teller_enrollment_id).toBe(enrollment.id);
  });

  it('listByEnrollment returns only accounts for that enrollment', () => {
    const e1 = createTellerEnrollment('T1');
    const e2 = createTellerEnrollment('T2');
    accountRepository.createTeller({ name: 'T1 Acc', teller_enrollment_id: e1.id, teller_account_id: 'ta1', actual_id: 'at1' });
    accountRepository.createTeller({ name: 'T2 Acc', teller_enrollment_id: e2.id, teller_account_id: 'ta2', actual_id: 'at2' });
    expect(accountRepository.listByEnrollment(e1.id)).toHaveLength(1);
  });

  it('cascades delete when the parent Teller enrollment is deleted', () => {
    const enrollment = createTellerEnrollment('del');
    accountRepository.createTeller({ name: 'Del Acc', teller_enrollment_id: enrollment.id, teller_account_id: 'ta3', actual_id: 'at3' });
    tellerRepository.delete(enrollment.id);
    expect(accountRepository.listAll()).toHaveLength(0);
  });
});

// ─── getSyncInfo ──────────────────────────────────────────────────────────────

describe('accountRepository.getSyncInfo', () => {
  it('returns name and actual_sync_id for a known actual_id', () => {
    const item = createPlaidItem('sync');
    accountRepository.createPlaid({
      name: 'My Account',
      plaid_item_id: item.id,
      plaid_account_id: 'pa-sync',
      actual_id: 'actual-known',
      actual_sync_id: 'sync-known',
    });
    expect(accountRepository.getSyncInfo('actual-known')).toEqual({
      name: 'My Account',
      actual_sync_id: 'sync-known',
    });
  });

  it('returns null for an unknown actual_id', () => {
    expect(accountRepository.getSyncInfo('unknown-actual-id')).toBeNull();
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe('accountRepository.update', () => {
  it('updates name, actual_id, and actual_sync_id', () => {
    const item = createPlaidItem('upd');
    const account = accountRepository.createPlaid({
      name: 'Old Name', plaid_item_id: item.id, plaid_account_id: 'pa-upd', actual_id: 'old-id', actual_sync_id: 'old-sync',
    });
    accountRepository.update(account.id, { name: 'New Name', actual_id: 'new-id', actual_sync_id: 'new-sync' });
    const updated = accountRepository.listAll()[0];
    expect(updated.name).toBe('New Name');
    expect(updated.actual_id).toBe('new-id');
    expect(updated.actual_sync_id).toBe('new-sync');
  });
});
