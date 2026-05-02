import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { login as apiLogin, verify2FA as apiVerify2FA } from '../services/api';
import { getAuthStatus } from '../services/settingsApi';

type AuthState =
  | { status: 'loading' }
  | { status: 'setup_required' }
  | { status: 'unauthenticated' }
  | { status: 'awaiting_2fa'; tempToken: string }
  | { status: 'authenticated'; token: string };

interface AuthContextValue {
  state: AuthState;
  login: (password: string) => Promise<void>;
  verify2FA: (code: string) => Promise<void>;
  logout: () => void;
  onSetupComplete: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 6;

    const attempt = () => {
      getAuthStatus()
        .then(({ setup_required }) => {
          if (!cancelled) {
            setState(setup_required ? { status: 'setup_required' } : { status: 'unauthenticated' });
          }
        })
        .catch(() => {
          if (cancelled) return;
          attempts += 1;
          if (attempts < MAX_ATTEMPTS) {
            setTimeout(attempt, 2000);
          } else {
            setState({ status: 'unauthenticated' });
          }
        });
    };

    attempt();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await apiLogin(password);
    if ('requires2fa' in result && result.requires2fa) {
      setState({ status: 'awaiting_2fa', tempToken: result.tempToken });
    } else if ('token' in result) {
      setState({ status: 'authenticated', token: result.token });
    }
  }, []);

  const verify2FA = useCallback(async (code: string) => {
    if (state.status !== 'awaiting_2fa') return;
    const { token } = await apiVerify2FA(state.tempToken, code);
    setState({ status: 'authenticated', token });
  }, [state]);

  const logout = useCallback(() => setState({ status: 'unauthenticated' }), []);

  const onSetupComplete = useCallback(() => setState({ status: 'unauthenticated' }), []);

  const token = state.status === 'authenticated' ? state.token : null;

  return (
    <AuthContext.Provider value={{ state, login, verify2FA, logout, onSetupComplete, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
