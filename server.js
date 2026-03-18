const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Serve compare.html and other static files from the project root
app.use(express.static(path.join(__dirname)));

// ── Column name constants (adjust if the view uses different names) ──
const CLASS_COL = 'idClass';   // column in checkGhosts matching definitionsCarClasses.id
const TRACK_COL = 'idTrack';   // column in checkGhosts matching definitionsTracks.id
const ID_COL    = 'id';        // primary key column in checkGhosts

// ── Allowed ghost table names (whitelist to prevent SQL injection) ────
const ALLOWED_TABLES = new Set(['checkGhosts', 'checkGhostsDuel']);
const DEFAULT_TABLE  = 'checkGhosts';

function resolveTable(req) {
  const t = req.query.table;
  if (!t) return DEFAULT_TABLE;
  if (!ALLOWED_TABLES.has(t)) return null; // invalid
  return t;
}

// Config without database — we'll discover the correct name at startup
const dbConfigBase = {
  host: '185.36.72.146',
  port: 3306,
  user: 'RaceReadOnly',
  password: 'mySec./Read@pass',
  connectTimeout: 15000,
};

let resolvedDb = 'raceclub'; // will be confirmed/corrected on startup

async function findDatabase(candidates) {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfigBase);
    const [rows] = await conn.execute('SHOW DATABASES');
    const names = rows.map(r => Object.values(r)[0]);
    console.log('Available databases:', names.join(', '));
    for (const c of candidates) {
      const found = names.find(n => n.toLowerCase() === c.toLowerCase());
      if (found) return found;
    }
    return null;
  } finally {
    if (conn) try { await conn.end(); } catch (_) {}
  }
}

function dbConfig() {
  return { ...dbConfigBase, database: resolvedDb };
}

// Normalize a row: convert Buffer → string, optionally exclude a column
function normalizeRow(row, excludeCol) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    if (excludeCol && key === excludeCol) continue;
    out[key] = Buffer.isBuffer(val) ? val.toString('utf8') : val;
  }
  return out;
}

// ── GET /api/ghosts?classId=X&trackId=Y ──────────────────────────────
// Returns all laps for the given class+track WITHOUT ghostData.
// Both classId and trackId are required.
app.get('/api/ghosts', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  const { classId, trackId } = req.query;

  if (!classId || !trackId) {
    return res.status(400).json({
      success: false,
      error: 'Seleziona sia la classe che il circuito per caricare i giri.',
    });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    // Select all columns EXCEPT ghostData; compute hasGhostData flag in SQL
    // to avoid transferring potentially huge longtext blobs over the wire.
    const [rows] = await connection.execute(
      `SELECT id, idDriver, driverNickname, idTrack, trackName, idClass, className,
              lapValueMs, lapValueI1Ms, lapValueI2Ms, lapValueI3Ms,
              cameraStabilizer, controlMode, autoTransmission, lapTimestamp,
              (ghostData IS NOT NULL AND LENGTH(ghostData) > 0) AS hasGhostData
       FROM \`${table}\`
       WHERE \`${CLASS_COL}\` = ? AND \`${TRACK_COL}\` = ?`,
      [classId, trackId]
    );

    const normalized = rows.map(row => {
      const r = normalizeRow(row);
      r.hasGhostData = !!r.hasGhostData;
      return r;
    });

    res.json({ success: true, data: normalized, count: normalized.length });
  } catch (error) {
    console.error('Database error (ghosts):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/ghost/:id ───────────────────────────────────────────────
// Returns ghostData for a single lap, looked up by primary key.
app.get('/api/ghost/:id', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ success: false, error: 'id is required' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [rows] = await connection.execute(
      `SELECT \`${ID_COL}\`, ghostData FROM \`${table}\` WHERE \`${ID_COL}\` = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Ghost not found' });
    }

    const row = rows[0];
    const ghostData = Buffer.isBuffer(row.ghostData)
      ? row.ghostData.toString('utf8')
      : row.ghostData;

    res.json({ success: true, id: row[ID_COL], ghostData });
  } catch (error) {
    console.error('Database error (ghost/:id):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/ghosts/columns ──────────────────────────────────────────
app.get('/api/ghosts/columns', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [rows] = await connection.execute(
      `SELECT COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [resolvedDb, table]
    );
    res.json({ success: true, columns: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/classes ─────────────────────────────────────────────────
app.get('/api/classes', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [rows] = await connection.execute(
      'SELECT id, name FROM definitionsCarClasses WHERE active=1 ORDER BY id'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/tracks ──────────────────────────────────────────────────
app.get('/api/tracks', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [rows] = await connection.execute(
      'SELECT id, name, trackKms FROM definitionsTracks WHERE active=1 ORDER BY `order`'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/overview ──────────────────────────────────────────
// Returns aggregate lap counts grouped by className and trackName.
app.get('/api/stats/overview', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [rows] = await connection.execute(
      `SELECT className, trackName, COUNT(*) as count FROM \`${table}\` GROUP BY className, trackName`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Database error (stats/overview):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/flags ─────────────────────────────────────────────
// Best lap per className/trackName/flag for controlMode, autoTransmission, cameraStabilizer
app.get('/api/stats/flags', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const q = (col) => `SELECT className, trackName, ${col}, MIN(lapValueMs) as bestLap, COUNT(*) as cnt
      FROM \`${table}\` WHERE lapValueMs IS NOT NULL GROUP BY className, trackName, ${col}`;
    const [[cm], [at], [cs]] = await Promise.all([
      connection.execute(q('controlMode')),
      connection.execute(q('autoTransmission')),
      connection.execute(q('cameraStabilizer')),
    ]);
    res.json({ success: true, controlMode: cm, autoTransmission: at, cameraStabilizer: cs });
  } catch (error) {
    console.error('Database error (stats/flags):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/player-coverage ─────────────────────────────────
// Unique player counts per track/class combo + per-player combo details
app.get('/api/stats/player-coverage', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [matrix] = await connection.execute(
      `SELECT ${TRACK_COL} AS idTrack, trackName, ${CLASS_COL} AS idClass, className,
              COUNT(DISTINCT driverNickname) AS uniquePlayers,
              COUNT(*) AS totalLaps
       FROM \`${table}\`
       GROUP BY ${TRACK_COL}, trackName, ${CLASS_COL}, className`
    );
    const [playerCombos] = await connection.execute(
      `SELECT driverNickname, ${TRACK_COL} AS idTrack, ${CLASS_COL} AS idClass, COUNT(*) AS laps
       FROM \`${table}\`
       GROUP BY driverNickname, ${TRACK_COL}, ${CLASS_COL}`
    );
    res.json({ success: true, matrix, playerCombos });
  } catch (error) {
    console.error('Database error (stats/player-coverage):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/player-profile ────────────────────────────────────
app.get('/api/stats/player-profile', async (req, res) => {
  const table = resolveTable(req);
  if (!table) return res.status(400).json({ success: false, error: 'Invalid table name' });

  const player = req.query.player;
  if (!player) return res.status(400).json({ success: false, error: 'player required' });
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    // Player best per combo
    const [playerBests] = await connection.execute(
      `SELECT \`${TRACK_COL}\` AS idTrack, trackName, \`${CLASS_COL}\` AS idClass, className,
              MIN(lapValueMs) AS playerBest, COUNT(*) AS lapCount
       FROM \`${table}\`
       WHERE driverNickname = ? AND lapValueMs IS NOT NULL
       GROUP BY \`${TRACK_COL}\`, trackName, \`${CLASS_COL}\`, className`,
      [player]
    );
    // All drivers' best per combo (for ranking)
    const [allBests] = await connection.execute(
      `SELECT \`${TRACK_COL}\` AS idTrack, \`${CLASS_COL}\` AS idClass,
              driverNickname, MIN(lapValueMs) AS bestTime
       FROM \`${table}\` WHERE lapValueMs IS NOT NULL
       GROUP BY \`${TRACK_COL}\`, \`${CLASS_COL}\`, driverNickname`
    );
    // Build rank maps in JS
    const comboMap = {};
    for (const r of allBests) {
      const key = `${r.idTrack}-${r.idClass}`;
      if (!comboMap[key]) comboMap[key] = [];
      comboMap[key].push({ driver: r.driverNickname, time: Number(r.bestTime) });
    }
    for (const key of Object.keys(comboMap)) {
      comboMap[key].sort((a, b) => a.time - b.time);
    }
    const profile = playerBests.map(r => {
      const key = `${r.idTrack}-${r.idClass}`;
      const ranking = comboMap[key] || [];
      const pos = ranking.findIndex(e => e.driver === player) + 1;
      const leaderBest = ranking[0]?.time || 0;
      return {
        idTrack: r.idTrack, trackName: r.trackName,
        idClass: r.idClass, className: r.className,
        playerBest: Number(r.playerBest),
        leaderBest,
        gap: Number(r.playerBest) - leaderBest,
        pos, total: ranking.length,
        lapCount: Number(r.lapCount),
      };
    });
    profile.sort((a, b) => a.className.localeCompare(b.className) || a.trackName.localeCompare(b.trackName));
    res.json({ success: true, player, profile });
  } catch (error) {
    console.error('Database error (stats/player-profile):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/duel/meta ───────────────────────────────────────────────
// Downloads all 4 tables needed by the Duel Level section in one request.
// Name resolution is done client-side using the returned lookup tables.
app.get('/api/duel/meta', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [[drivers], [classes], [tracks], [levels]] = await Promise.all([
      connection.execute(
        'SELECT id, nickname, nationCode, preferredNumber FROM drivers WHERE active=1 ORDER BY nickname'
      ),
      connection.execute(
        'SELECT id, name FROM definitionsCarClasses WHERE active=1 ORDER BY id'
      ),
      connection.execute(
        'SELECT id, name, trackKms FROM definitionsTracks WHERE active=1 ORDER BY `order`'
      ),
      connection.execute(
        'SELECT id, idDriver, idTrack, idClass, level, points, lastUpdateDateTime FROM statsAiDuelDrivers ORDER BY level DESC'
      ),
    ]);
    res.json({ success: true, drivers, classes, tracks, duelLevels: levels });
  } catch (error) {
    console.error('Database error (duel/meta):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/general-meta ──────────────────────────────────────
// Downloads all tables needed by the General Statistics page in one request.
app.get('/api/stats/general-meta', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [[drivers], [classes], [tracks], [gameModes], [details]] = await Promise.all([
      connection.execute(
        'SELECT id, nickname, nationCode, preferredNumber, creationDate, lastLoginDateTime FROM drivers WHERE active=1 ORDER BY nickname'
      ),
      connection.execute(
        'SELECT id, name FROM definitionsCarClasses WHERE active=1 ORDER BY id'
      ),
      connection.execute(
        'SELECT id, name, trackKms FROM definitionsTracks WHERE active=1 ORDER BY `order`'
      ),
      connection.execute(
        'SELECT id, name, description FROM definitionsGameModes WHERE active=1 ORDER BY id'
      ),
      connection.execute(
        'SELECT id, idDriver, idGameMode, idTrack, idClass, totalLaps, totalKms, creationDate FROM statsDetails'
      ),
    ]);
    res.json({ success: true, drivers, classes, tracks, gameModes, statsDetails: details });
  } catch (error) {
    console.error('Database error (stats/general-meta):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/drivers ───────────────────────────────────────────
app.get('/api/stats/drivers', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [rows] = await connection.execute(
      'SELECT id, nickname, creationDate, lastLoginDateTime FROM drivers WHERE active=1 ORDER BY nickname'
    );
    res.json({ success: true, drivers: rows });
  } catch (error) {
    console.error('Database error (stats/drivers):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/stats/behavioral ────────────────────────────────────────
app.get('/api/stats/behavioral', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());
    const [[sessions]] = await Promise.all([
      connection.execute('SELECT * FROM SessionStats ORDER BY CAST(TempoTotalegioco AS UNSIGNED) DESC'),
    ]);
    res.json({ success: true, sessions });
  } catch (error) {
    console.error('Database error (stats/behavioral):', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig());

    // Discover column names dynamically
    const [cols] = await connection.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usersIntelligence'
       ORDER BY ORDINAL_POSITION`,
      [resolvedDb]
    );
    const colNames = cols.map(c => c.COLUMN_NAME);

    const userCol = colNames.find(c => ['username', 'user', 'email', 'login', 'nickname'].includes(c.toLowerCase()));
    const passCol = colNames.find(c => ['password', 'pass', 'pwd', 'passwd'].includes(c.toLowerCase()));

    if (!userCol || !passCol) {
      return res.status(500).json({ error: `Cannot identify login columns. Available: ${colNames.join(', ')}` });
    }

    const [rows] = await connection.execute(
      `SELECT * FROM usersIntelligence WHERE \`${userCol}\` = ? AND \`${passCol}\` = ?`,
      [username, password]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

    const user = { ...rows[0] };
    delete user[passCol];
    res.json({ success: true, user });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── GET /api/health ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export app for serverless (Netlify Functions)
module.exports = app;

// Only start the HTTP server when run directly (local dev)
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`\n✅ API Server running on http://localhost:${PORT}`);
    const found = await findDatabase(['nestSkeleton', 'netSkeleton', 'netskeleton', 'nestskeleton']);
    if (found) {
      resolvedDb = found;
      console.log(`📡 Database resolved: ${found} (tables: ${[...ALLOWED_TABLES].join(', ')})`);
    } else {
      console.warn(`⚠️  Could not find netSkeleton — using '${resolvedDb}' as fallback`);
    }
    console.log(`🌐 Compare page:  http://localhost:${PORT}/compare.html`);
    console.log(`🌐 React app:     http://localhost:5173\n`);
  });
}
