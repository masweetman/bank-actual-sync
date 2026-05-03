import type { AppSettings, AuthStatus, Account, ActualAccount, PlaidItem, PlaidAccountInfo } from '../types';

const API = '/api';

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API}/auth/status`);
  if (!res.ok) throw new Error(`Auth status check failed: ${res.status}`);
  return res.json() as Promise<AuthStatus>;
}

export async function setupAdmin(password: string): Promise<void> {
  const res = await fetch(`${API}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Setup failed');
  }
}

export async function getSettings(token: string): Promise<AppSettings> {
  const res = await fetch(`${API}/settings`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json() as Promise<AppSettings>;
}

export async function saveSettings(token: string, settings: Partial<AppSettings> & { actual_password?: string }): Promise<void> {
  const res = await fetch(`${API}/settings`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to save settings');
  }
}

export async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API}/auth/change-password`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to change password');
  }
}

export async function setup2FA(token: string): Promise<{ qrDataUrl: string; secret: string }> {
  const res = await fetch(`${API}/auth/2fa/setup`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to start 2FA setup');
  return res.json() as Promise<{ qrDataUrl: string; secret: string }>;
}

export async function enable2FA(token: string, secret: string, code: string): Promise<void> {
  const res = await fetch(`${API}/auth/2fa/enable`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ secret, code }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to enable 2FA');
  }
}

export async function disable2FA(token: string, code: string): Promise<void> {
  const res = await fetch(`${API}/auth/2fa/disable`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to disable 2FA');
  }
}

// ─── Plaid ────────────────────────────────────────────────────────────────────

export async function createLinkToken(token: string): Promise<string> {
  const res = await fetch(`${API}/plaid/link-token`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to create link token');
  }
  const { link_token } = (await res.json()) as { link_token: string };
  return link_token;
}

export async function exchangePlaidToken(
  token: string,
  publicToken: string,
): Promise<{ item: PlaidItem; accounts: PlaidAccountInfo[] }> {
  const res = await fetch(`${API}/plaid/exchange-token`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ public_token: publicToken }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to exchange Plaid token');
  }
  return res.json() as Promise<{ item: PlaidItem; accounts: PlaidAccountInfo[] }>;
}

export async function listPlaidItems(token: string): Promise<PlaidItem[]> {
  const res = await fetch(`${API}/plaid/items`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to load connected banks');
  return res.json() as Promise<PlaidItem[]>;
}

export async function deletePlaidItem(token: string, itemId: string): Promise<void> {
  const res = await fetch(`${API}/plaid/items/${itemId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to disconnect bank');
  }
}

export async function createReconnectLinkToken(token: string, itemId: string): Promise<string> {
  const res = await fetch(`${API}/plaid/reconnect-link-token`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ item_id: itemId }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to create reconnect link token');
  }
  const { link_token } = (await res.json()) as { link_token: string };
  return link_token;
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts(token: string): Promise<Account[]> {
  const res = await fetch(`${API}/accounts`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to load accounts');
  return res.json() as Promise<Account[]>;
}

export async function createAccount(
  token: string,
  data: { name: string; plaid_item_id: string; plaid_account_id: string; actual_id?: string },
): Promise<Account> {
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to create account');
  }
  return res.json() as Promise<Account>;
}

export async function updateAccount(
  token: string,
  id: string,
  data: { name: string; actual_id?: string; actual_sync_id?: string },
): Promise<void> {
  const res = await fetch(`${API}/accounts/${id}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to update account');
  }
}

export async function deleteAccount(token: string, id: string): Promise<void> {
  const res = await fetch(`${API}/accounts/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to delete account');
  }
}

// ─── Actual Budget ────────────────────────────────────────────────────────────

export async function fetchActualAccounts(
  token: string,
  syncId: string,
): Promise<ActualAccount[]> {
  const res = await fetch(`${API}/actual/accounts`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ syncId }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Failed to fetch Actual accounts');
  }
  return res.json() as Promise<ActualAccount[]>;
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export interface RunNowResult {
  plaid: { totalAdded: number; errors: string[] };
  actual: { imported: number; skipped: number; errors: string[]; failedIds: string[] };
}

export async function runScheduleNow(token: string): Promise<RunNowResult> {
  const res = await fetch(`${API}/schedule/run-now`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Sync failed');
  }
  return res.json() as Promise<RunNowResult>;
}
