import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema';
import { tellerRepository } from '../db/tellerRepository';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.exec('DELETE FROM teller_enrollments');
});

const ENROLLMENT_DATA = {
  enrollment_id: 'enr-abc123',
  institution_name: 'Teller Bank',
  access_token: 'teller-token-secret',
};

describe('tellerRepository', () => {
  describe('create / listAll', () => {
    it('creates an enrollment and returns it', () => {
      const enrollment = tellerRepository.create(ENROLLMENT_DATA);
      expect(enrollment.enrollment_id).toBe('enr-abc123');
      expect(enrollment.institution_name).toBe('Teller Bank');
      expect(enrollment.last_synced_at).toBeNull();
      expect(typeof enrollment.id).toBe('string');
    });

    it('lists all created enrollments', () => {
      tellerRepository.create(ENROLLMENT_DATA);
      tellerRepository.create({ ...ENROLLMENT_DATA, enrollment_id: 'enr-def456', institution_name: 'Other Bank' });
      expect(tellerRepository.listAll()).toHaveLength(2);
    });
  });

  describe('getAccessToken', () => {
    it('returns the decrypted access token', () => {
      const enrollment = tellerRepository.create(ENROLLMENT_DATA);
      expect(tellerRepository.getAccessToken(enrollment.id)).toBe('teller-token-secret');
    });

    it('returns null for an unknown id', () => {
      expect(tellerRepository.getAccessToken('unknown-id')).toBeNull();
    });
  });

  describe('getById', () => {
    it('returns the enrollment by id', () => {
      const enrollment = tellerRepository.create(ENROLLMENT_DATA);
      const found = tellerRepository.getById(enrollment.id);
      expect(found?.enrollment_id).toBe('enr-abc123');
    });

    it('returns null for an unknown id', () => {
      expect(tellerRepository.getById('unknown-id')).toBeNull();
    });
  });

  describe('updateLastSynced', () => {
    it('persists the last_synced_at timestamp', () => {
      const enrollment = tellerRepository.create(ENROLLMENT_DATA);
      const ts = '2024-06-15T12:00:00.000Z';
      tellerRepository.updateLastSynced(enrollment.id, ts);
      expect(tellerRepository.getById(enrollment.id)?.last_synced_at).toBe(ts);
    });
  });

  describe('delete', () => {
    it('removes the enrollment', () => {
      const enrollment = tellerRepository.create(ENROLLMENT_DATA);
      tellerRepository.delete(enrollment.id);
      expect(tellerRepository.listAll()).toHaveLength(0);
    });

    it('is a no-op for an unknown id', () => {
      tellerRepository.create(ENROLLMENT_DATA);
      tellerRepository.delete('unknown-id');
      expect(tellerRepository.listAll()).toHaveLength(1);
    });
  });
});
