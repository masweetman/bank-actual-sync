import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema';
import { repository } from '../db/repository';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.exec('DELETE FROM transactions');
});

const BASE_TX = {
  id: 'tx-001',
  bank_account: 'Checking',
  actual_account_id: 'actual-acc-uuid',
  date: '2024-06-01',
  amount: -5000,
  payee: 'Coffee Shop',
  memo: '',
  cleared: true,
  pending_transaction_id: null as string | null,
  fetched_at: new Date().toISOString(),
};

describe('upsertMany / listStaged', () => {
  it('inserts transactions with status=staged', () => {
    repository.upsertMany([BASE_TX]);
    const staged = repository.listStaged();
    expect(staged).toHaveLength(1);
    expect(staged[0].id).toBe('tx-001');
    expect(staged[0].status).toBe('staged');
  });

  it('does not downgrade a synced transaction back to staged on re-upsert', () => {
    repository.upsertMany([BASE_TX]);
    repository.markSynced('tx-001');
    repository.upsertMany([BASE_TX]); // same cleared=true tx arrives again
    expect(repository.listStaged()).toHaveLength(0);
    expect(repository.listSynced()[0].status).toBe('synced');
  });

  it('re-stages a synced pending tx when the cleared version arrives', () => {
    // Pending tx arrives first
    const pendingTx = { ...BASE_TX, id: 'tx-pending', cleared: false };
    repository.upsertMany([pendingTx]);
    repository.markSynced('tx-pending');
    expect(repository.listStaged()).toHaveLength(0);

    // Cleared version arrives with same id
    const clearedTx = { ...pendingTx, cleared: true };
    repository.upsertMany([clearedTx]);

    const staged = repository.listStaged();
    expect(staged).toHaveLength(1);
    expect(staged[0].id).toBe('tx-pending');
    expect(staged[0].cleared).toBe(true);
    // pending_transaction_id is set to the tx's own id by the upsert logic
    expect(staged[0].pending_transaction_id).toBe('tx-pending');
  });

  it('upserts multiple transactions at once', () => {
    const txs = [
      { ...BASE_TX, id: 'tx-a' },
      { ...BASE_TX, id: 'tx-b' },
      { ...BASE_TX, id: 'tx-c' },
    ];
    repository.upsertMany(txs);
    expect(repository.listStaged()).toHaveLength(3);
  });
});

describe('listSynced', () => {
  it('returns only synced transactions', () => {
    repository.upsertMany([BASE_TX]);
    repository.markSynced('tx-001');
    expect(repository.listSynced()).toHaveLength(1);
    expect(repository.listStaged()).toHaveLength(0);
  });
});

describe('markSynced', () => {
  it('transitions a staged tx to synced', () => {
    repository.upsertMany([BASE_TX]);
    repository.markSynced('tx-001');
    const synced = repository.listSynced();
    expect(synced[0].status).toBe('synced');
  });
});

describe('markExcluded', () => {
  it('excludes a staged transaction (removes from staged)', () => {
    repository.upsertMany([BASE_TX]);
    repository.markExcluded('tx-001');
    expect(repository.listStaged()).toHaveLength(0);
  });
});

describe('markStaged', () => {
  it('re-stages an excluded transaction', () => {
    repository.upsertMany([BASE_TX]);
    repository.markExcluded('tx-001');
    repository.markStaged('tx-001');
    const staged = repository.listStaged();
    expect(staged[0].status).toBe('staged');
  });
});

describe('deleteStaged', () => {
  it('deletes a staged transaction', () => {
    repository.upsertMany([BASE_TX]);
    repository.deleteStaged('tx-001');
    expect(repository.listStaged()).toHaveLength(0);
  });

  it('does NOT delete a synced transaction', () => {
    repository.upsertMany([BASE_TX]);
    repository.markSynced('tx-001');
    repository.deleteStaged('tx-001'); // should be a no-op
    expect(repository.listSynced()).toHaveLength(1);
  });

  it('is a no-op for an unknown id', () => {
    repository.deleteStaged('does-not-exist');
    expect(repository.listStaged()).toHaveLength(0);
  });
});
