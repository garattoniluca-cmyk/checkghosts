import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import DuelMode from './DuelMode.jsx';
import GeneralStats from './GeneralStats.jsx';
import BehavioralStats from './BehavioralStats.jsx';
import Dashboard from './Dashboard.jsx';
import Login from './Login.jsx';
import './App.css';

function Root() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('rc_user'));
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!authed) {
    return (
      <Login
        onLogin={user => {
          localStorage.setItem('rc_user', JSON.stringify(user));
          setAuthed(true);
        }}
      />
    );
  }

  function handleLogout() {
    localStorage.removeItem('rc_user');
    setAuthed(false);
  }

  if (hash === '#/hotlap')     return <App onLogout={handleLogout} />;
  if (hash === '#/duel')       return <DuelMode onLogout={handleLogout} />;
  if (hash === '#/stats')      return <GeneralStats onLogout={handleLogout} />;
  if (hash === '#/behavioral') return <BehavioralStats onLogout={handleLogout} />;
  return <Dashboard onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
