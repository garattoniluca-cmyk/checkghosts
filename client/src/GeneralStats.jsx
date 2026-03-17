import { useState, useEffect, useCallback } from 'react';
import StatsAnalytics from './components/StatsAnalytics';

export default function GeneralStats() {
  const [meta, setMeta] = useState({
    drivers: [], classes: [], tracks: [], gameModes: [], statsDetails: [],
  });
  const [loading, setLoading] = useState(false);

  const fetchMeta = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/stats/general-meta');
      const data = await res.json();
      if (data.success) setMeta(data);
    } catch (err) {
      console.error('Failed to load general stats meta:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  return (
    <StatsAnalytics
      drivers={meta.drivers}
      classes={meta.classes}
      tracks={meta.tracks}
      gameModes={meta.gameModes}
      statsDetails={meta.statsDetails}
      loading={loading}
      onReload={fetchMeta}
    />
  );
}
