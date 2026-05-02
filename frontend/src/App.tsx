import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginGate } from './components/LoginGate';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';

type Page = 'dashboard' | 'settings';

function AppContent() {
  const { state } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  if (state.status !== 'authenticated') {
    return <LoginGate><></></LoginGate>;
  }

  return (
    <>
      <nav style={{ display: 'flex', gap: '1rem', padding: '0.75rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
        <button onClick={() => setPage('dashboard')} style={{ background: 'none', border: 'none', fontWeight: page === 'dashboard' ? 700 : 400, cursor: 'pointer', color: page === 'dashboard' ? '#2563eb' : '#555' }}>
          Dashboard
        </button>
        <button onClick={() => setPage('settings')} style={{ background: 'none', border: 'none', fontWeight: page === 'settings' ? 700 : 400, cursor: 'pointer', color: page === 'settings' ? '#2563eb' : '#555' }}>
          Settings
        </button>
      </nav>
      {page === 'dashboard' ? <Dashboard /> : <Settings />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
