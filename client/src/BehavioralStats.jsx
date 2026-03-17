import { useState, useEffect, useCallback } from 'react';
import BehavioralAnalytics from './components/BehavioralAnalytics';

export default function BehavioralStats() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/stats/behavioral');
      const data = await res.json();
      if (data.success) setSessions(data.sessions);
    } catch (err) {
      console.error('Failed to load behavioral stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <BehavioralAnalytics
      sessions={sessions}
      loading={loading}
      onReload={fetchData}
    />
  );
}
