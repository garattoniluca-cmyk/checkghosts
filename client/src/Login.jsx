import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed'); return; }
      onLogin(data.user);
    } catch {
      setError('Connection error — server not reachable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.root}>
      {/* Left panel — hero image */}
      <div style={styles.hero}>
        <img src="/raceclub-hero.jpg" alt="Race Club" style={styles.heroImg} />
        <div style={styles.heroOverlay} />
        <div style={styles.heroText}>
          <div style={styles.eyebrow}>Intelligence Platform</div>
          <div style={styles.heroTitle}>RACE<br />CLUB</div>
          <div style={styles.heroSub}>Analytics · Rankings · Ghost Analysis</div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={styles.panel}>
        <form onSubmit={handleSubmit} style={styles.form} autoComplete="on">
          {/* Logo mark */}
          <div style={styles.logoMark}>
            <span style={styles.logoRC}>RC</span>
            <span style={styles.logoLabel}>INTELLIGENCE</span>
          </div>

          <h1 style={styles.title}>Sign in</h1>
          <p style={styles.subtitle}>Enter your credentials to access the platform</p>

          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="your username"
            required
            onFocus={e => e.target.style.borderColor = '#F5C518'}
            onBlur={e => e.target.style.borderColor = '#2a2a2a'}
          />

          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            onFocus={e => e.target.style.borderColor = '#F5C518'}
            onBlur={e => e.target.style.borderColor = '#2a2a2a'}
          />

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <div style={styles.footer}>RaceClub Intelligence · {new Date().getFullYear()}</div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    background: '#0a0a0a',
    overflow: 'hidden',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },

  // ── Hero ────────────────────────────────────────────────────────────
  hero: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    minWidth: 0,
    display: 'flex',
    alignItems: 'flex-end',
  },
  heroImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center top',
    filter: 'brightness(0.75)',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(120deg, rgba(10,10,10,0.6) 0%, transparent 60%), linear-gradient(to top, rgba(10,10,10,0.9) 0%, transparent 50%)',
  },
  heroText: {
    position: 'relative',
    padding: '3rem',
    color: '#fff',
  },
  eyebrow: {
    fontSize: '0.72rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: '#F5C518',
    marginBottom: '0.5rem',
    fontWeight: 600,
  },
  heroTitle: {
    fontSize: 'clamp(3.5rem, 7vw, 6rem)',
    fontWeight: 900,
    lineHeight: 0.9,
    letterSpacing: '-0.02em',
    textShadow: '0 2px 40px rgba(0,0,0,0.6)',
    marginBottom: '1rem',
  },
  heroSub: {
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: '0.06em',
  },

  // ── Login panel ─────────────────────────────────────────────────────
  panel: {
    width: '420px',
    flexShrink: 0,
    background: '#111',
    borderLeft: '1px solid #1e1e1e',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '3rem 2.5rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginTop: '2rem',
  },
  logoMark: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '2.5rem',
  },
  logoRC: {
    background: '#E91E63',
    color: '#fff',
    fontWeight: 900,
    fontSize: '1.1rem',
    letterSpacing: '0.04em',
    padding: '0.3rem 0.55rem',
    borderRadius: '6px',
  },
  logoLabel: {
    color: '#F5C518',
    fontWeight: 700,
    fontSize: '0.78rem',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
  },
  title: {
    margin: 0,
    fontSize: '1.9rem',
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    margin: '0.4rem 0 0.5rem',
    color: '#555',
    fontSize: '0.85rem',
  },
  label: {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#888',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: '-0.4rem',
  },
  input: {
    background: '#1a1a1a',
    border: '1.5px solid #2a2a2a',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '0.95rem',
    padding: '0.75rem 1rem',
    outline: 'none',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  },
  error: {
    background: 'rgba(233,30,99,0.12)',
    border: '1px solid rgba(233,30,99,0.3)',
    borderRadius: '8px',
    color: '#E91E63',
    fontSize: '0.82rem',
    padding: '0.65rem 1rem',
  },
  btn: {
    marginTop: '0.5rem',
    background: '#F5C518',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 800,
    fontSize: '0.95rem',
    letterSpacing: '0.04em',
    padding: '0.85rem 1.5rem',
    cursor: 'pointer',
    transition: 'opacity 0.15s, transform 0.1s',
  },
  footer: {
    fontSize: '0.72rem',
    color: '#333',
    textAlign: 'center',
    letterSpacing: '0.06em',
  },
};
