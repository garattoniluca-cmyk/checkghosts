import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import DuelMode from './DuelMode.jsx';
import GeneralStats from './GeneralStats.jsx';
import Dashboard from './Dashboard.jsx';
import './App.css';

function Root() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash === '#/hotlap') return <App />;
  if (hash === '#/duel')   return <DuelMode />;
  if (hash === '#/stats')  return <GeneralStats />;
  return <Dashboard />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
