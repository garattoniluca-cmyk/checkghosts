import { useState, useEffect, useCallback } from 'react';
import RankingTelemetry from './components/RankingTelemetry';
import DuelLevels from './components/DuelLevels';

export default function DuelMode() {
  const [meta, setMeta]             = useState({ drivers: [], classes: [], tracks: [], duelLevels: [] });
  const [metaLoading, setMetaLoading] = useState(false);
  const [rankTrigger, setRankTrigger] = useState(0);

  const fetchMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const res  = await fetch('/api/duel/meta');
      const data = await res.json();
      if (data.success) setMeta(data);
    } catch (err) {
      console.error('Failed to load duel meta:', err);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  // Combined reload: refresh meta tables AND trigger RankingTelemetry internal reload
  const handleReloadAll = useCallback(() => {
    fetchMeta();
    setRankTrigger(k => k + 1);
  }, [fetchMeta]);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  return (
    <>
      <DuelLevels
        drivers={meta.drivers}
        classes={meta.classes}
        tracks={meta.tracks}
        duelLevels={meta.duelLevels}
        loading={metaLoading}
        onReload={handleReloadAll}
      />
      <RankingTelemetry
        tableName="checkGhostsDuel"
        pageTitle="Duel Mode"
        pageSubtitle="Lap Time Analyzer"
        pageIcon="⚔️"
        hideControls={true}
        reloadTrigger={rankTrigger}
      />
    </>
  );
}
