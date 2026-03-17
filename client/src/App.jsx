import RankingTelemetry from './components/RankingTelemetry';

export default function App() {
  return (
    <RankingTelemetry
      tableName="checkGhosts"
      pageTitle="HotLap Mode"
      pageSubtitle="Lap Time Analyzer"
      pageIcon="🏎"
    />
  );
}
