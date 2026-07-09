import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../hooks/useAuth';

vi.mock('../services/settingsApi');
vi.mock('../services/api');

import { getAuthStatus } from '../services/settingsApi';
import { login as apiLogin, verify2FA as apiVerify2FA } from '../services/api';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(AuthProvider, null, children);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAuth state machine', () => {
  it('starts in the loading state', () => {
    vi.mocked(getAuthStatus).mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state.status).toBe('loading');
  });

  it('transitions to unauthenticated when setup is complete', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: false, has_2fa: false });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));
  });

  it('transitions to setup_required when no admin password is set', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: true, has_2fa: false });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('setup_required'));
  });

  it('transitions to authenticated after successful login without 2FA', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: false, has_2fa: false });
    vi.mocked(apiLogin).mockResolvedValue({ token: 'jwt-token-abc' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));

    await act(async () => {
      await result.current.login('password');
    });

    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.token).toBe('jwt-token-abc');
  });

  it('transitions to awaiting_2fa when the server requires 2FA', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: false, has_2fa: true });
    vi.mocked(apiLogin).mockResolvedValue({ requires2fa: true, tempToken: 'temp-tok-xyz' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));

    await act(async () => {
      await result.current.login('password');
    });

    expect(result.current.state.status).toBe('awaiting_2fa');
    expect(result.current.token).toBeNull();
  });

  it('transitions to authenticated after successful verify2FA', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: false, has_2fa: true });
    vi.mocked(apiLogin).mockResolvedValue({ requires2fa: true, tempToken: 'temp-tok-xyz' });
    vi.mocked(apiVerify2FA).mockResolvedValue({ token: 'full-jwt-token' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));

    await act(async () => { await result.current.login('password'); });
    expect(result.current.state.status).toBe('awaiting_2fa');

    await act(async () => { await result.current.verify2FA('123456'); });
    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.token).toBe('full-jwt-token');
  });

  it('transitions to unauthenticated after logout', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: false, has_2fa: false });
    vi.mocked(apiLogin).mockResolvedValue({ token: 'jwt-token-abc' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('unauthenticated'));

    await act(async () => { await result.current.login('password'); });
    expect(result.current.state.status).toBe('authenticated');

    act(() => { result.current.logout(); });
    expect(result.current.state.status).toBe('unauthenticated');
    expect(result.current.token).toBeNull();
  });

  it('transitions to unauthenticated after onSetupComplete', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ setup_required: true, has_2fa: false });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('setup_required'));

    act(() => { result.current.onSetupComplete(); });
    expect(result.current.state.status).toBe('unauthenticated');
  });

  it('falls back to unauthenticated after exhausting all retries (MAX_ATTEMPTS=6)', async () => {
    vi.useFakeTimers();
    vi.mocked(getAuthStatus).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    // renderHook's internal act() flushes the initial attempt's promise rejection,
    // leaving one 2000ms retry timer queued. runAllTimersAsync runs all chained
    // timers until none remain (after the 6th failure no more setTimeout is queued).
    await act(() => vi.runAllTimersAsync());

    expect(result.current.state.status).toBe('unauthenticated');
    vi.useRealTimers();
  });
});
