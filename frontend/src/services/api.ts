const BACKEND = '/api';

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function login(password: string): Promise<{ token: string } | { requires2fa: true; tempToken: string }> {
  const res = await fetch(`${BACKEND}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Login failed');
  }
  return res.json() as Promise<{ token: string } | { requires2fa: true; tempToken: string }>;
}

export async function verify2FA(tempToken: string, code: string): Promise<{ token: string }> {
  const res = await fetch(`${BACKEND}/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken, code }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Invalid code');
  }
  return res.json() as Promise<{ token: string }>;
}

export async function fetchTransactions(token: string) {
  const res = await fetch(`${BACKEND}/transactions`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function fetchSyncedTransactions(token: string) {
  const res = await fetch(`${BACKEND}/transactions/synced`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch synced transactions');
  return res.json();
}

export async function excludeTransaction(token: string, id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/transactions/${encodeURIComponent(id)}/exclude`, {
    method: 'PATCH',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to exclude transaction');
}

export async function includeTransaction(token: string, id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/transactions/${encodeURIComponent(id)}/include`, {
    method: 'PATCH',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to re-include transaction');
}

export async function unstageTransaction(token: string, id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/transactions/${encodeURIComponent(id)}/unstage`, {
    method: 'PATCH',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to reset transaction to staged');
}

export async function syncToActual(token: string) {
  const res = await fetch(`${BACKEND}/sync-to-actual`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? 'Sync failed');
  }
  return res.json();
}
