import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema';
import { plaidRepository } from '../db/plaidRepository';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.exec('DELETE FROM plaid_items');
});

const ITEM_DATA = {
  item_id: 'item-abc',
  institution_id: 'ins-001',
  institution_name: 'Test Bank',
  access_token: 'access-sandbox-abc123',
};

describe('plaidRepository', () => {
  describe('create / listAll', () => {
    it('creates a Plaid item and returns it', () => {
      const item = plaidRepository.create(ITEM_DATA);
      expect(item.item_id).toBe('item-abc');
      expect(item.institution_name).toBe('Test Bank');
      expect(item.cursor).toBe('');
      expect(typeof item.id).toBe('string');
    });

    it('lists all created items', () => {
      plaidRepository.create(ITEM_DATA);
      plaidRepository.create({ ...ITEM_DATA, item_id: 'item-def', institution_name: 'Another Bank' });
      expect(plaidRepository.listAll()).toHaveLength(2);
    });

    it('does not include the access token in listAll results', () => {
      plaidRepository.create(ITEM_DATA);
      const items = plaidRepository.listAll();
      expect((items[0] as Record<string, unknown>)['access_token']).toBeUndefined();
    });
  });

  describe('getAccessToken', () => {
    it('returns the decrypted access token', () => {
      const item = plaidRepository.create(ITEM_DATA);
      expect(plaidRepository.getAccessToken(item.id)).toBe('access-sandbox-abc123');
    });

    it('returns null for an unknown id', () => {
      expect(plaidRepository.getAccessToken('unknown-id')).toBeNull();
    });
  });

  describe('getById', () => {
    it('returns the item by id', () => {
      const item = plaidRepository.create(ITEM_DATA);
      const found = plaidRepository.getById(item.id);
      expect(found?.item_id).toBe('item-abc');
    });

    it('returns null for an unknown id', () => {
      expect(plaidRepository.getById('unknown-id')).toBeNull();
    });
  });

  describe('updateCursor', () => {
    it('persists the cursor value', () => {
      const item = plaidRepository.create(ITEM_DATA);
      plaidRepository.updateCursor(item.id, 'cursor-xyz-789');
      expect(plaidRepository.getById(item.id)?.cursor).toBe('cursor-xyz-789');
    });
  });

  describe('getByInstitutionId', () => {
    it('returns the item when institution_id matches', () => {
      const item = plaidRepository.create(ITEM_DATA);
      const found = plaidRepository.getByInstitutionId('ins-001');
      expect(found?.id).toBe(item.id);
      expect(found?.institution_id).toBe('ins-001');
    });

    it('returns null when institution_id does not match', () => {
      plaidRepository.create(ITEM_DATA);
      expect(plaidRepository.getByInstitutionId('ins-999')).toBeNull();
    });

    it('returns null for an empty institution_id (guard against legacy rows)', () => {
      expect(plaidRepository.getByInstitutionId('')).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the item from the list', () => {
      const item = plaidRepository.create(ITEM_DATA);
      plaidRepository.delete(item.id);
      expect(plaidRepository.listAll()).toHaveLength(0);
    });

    it('is a no-op for an unknown id', () => {
      plaidRepository.create(ITEM_DATA);
      plaidRepository.delete('unknown-id');
      expect(plaidRepository.listAll()).toHaveLength(1);
    });
  });
});
