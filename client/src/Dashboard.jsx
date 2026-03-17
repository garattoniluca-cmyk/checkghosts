import './Dashboard.css';

function Card({ icon, title, desc, active, onClick }) {
  return (
    <div className={`db-card ${active ? 'active' : 'disabled'}`} onClick={active ? onClick : undefined}>
      <div className="db-card-icon">{icon}</div>
      <div className="db-card-title">{title}</div>
      {desc && <div className="db-card-desc">{desc}</div>}
      {active && <div className="db-card-arrow">Open →</div>}
    </div>
  );
}

function SubCard({ icon, title, desc, active, onClick }) {
  return (
    <div className={`db-subcard ${active ? 'active' : 'disabled'}`} onClick={active ? onClick : undefined}>
      <div className="db-subcard-icon">{icon}</div>
      <div className="db-subcard-title">{title}</div>
      {desc && <div className="db-subcard-desc">{desc}</div>}
      {active && <div className="db-subcard-arrow">Open →</div>}
    </div>
  );
}

export default function Dashboard() {
  const go = (hash) => { window.location.hash = hash; };

  return (
    <div className="db-root">

      {/* Header */}
      <header className="db-header">
        <div className="db-logo">
          <span className="db-logo-icon">🏎</span>
          <span className="db-logo-text">Race<span>Club</span> Intelligence</span>
        </div>
        <div className="db-badge">Alpha</div>
      </header>

      <main className="db-main">

        {/* AI */}
        <div className="db-section-label">Artificial Intelligence</div>
        <div className="db-grid">
          <Card
            icon="🤖"
            title="RaceClub AI"
            desc="AI assistant for advanced analysis, driving tips and race predictions."
            active={false}
          />
        </div>

        {/* Statistiche */}
        <div className="db-section-label">Statistiche</div>
        <div className="db-grid">
          <Card
            icon="📊"
            title="General Statistics"
            desc="Global overview of all data collected by the platform."
            active={true}
            onClick={() => go('/stats')}
          />
          <Card
            icon="🧠"
            title="Behavioral Statistics"
            desc="Analysis of driving patterns, recurring errors and progression over time."
            active={false}
          />
          <Card
            icon="🔍"
            title="Single User Deep Analysis"
            desc="In-depth analysis of a single driver across all sessions."
            active={false}
          />
        </div>

        {/* Game Modes */}
        <div className="db-section-label">Game Modes Stats</div>
        <div className="db-gamemodes">
          <div className="db-gamemodes-title">
            <span>🎮</span> Game Modes
          </div>
          <div className="db-gamemodes-grid">
            <SubCard
              icon="🏎"
              title="Hotlap"
              desc="Fast lap analysis, rankings and ghost comparison for each track/class combination."
              active={true}
              onClick={() => go('/hotlap')}
            />
            <SubCard
              icon="⚔️"
              title="Duel"
              desc="Statistics and comparisons for 1v1 duel sessions."
              active={true}
              onClick={() => go('/duel')}
            />
            <SubCard
              icon="🏁"
              title="Races"
              desc="Results, lap times and analysis of multi-driver races."
              active={false}
            />
          </div>
        </div>

        {/* Live Dashboard */}
        <div className="db-section-label">Live</div>
        <div className="db-grid">
          <Card
            icon="📡"
            title="Live Dashboard"
            desc="Real-time monitoring of active sessions, live rankings and instant updates."
            active={false}
          />
        </div>

        {/* Mobile */}
        <div className="db-section-label">Ecosystem</div>
        <div className="db-grid">
          <Card
            icon="📱"
            title="User Mobile APP"
            desc="Mobile app to follow real-time statistics from the paddock."
            active={false}
          />
        </div>

      </main>

      <footer className="db-footer">
        RaceClub Intelligence · All rights reserved
      </footer>

    </div>
  );
}
