import { useState } from 'react'

// The logged-in person, as returned by the API.
export type User = { id: number; email: string }

// One form that works as either "Log in" or "Sign up".
export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false) // true while waiting for the server

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch(mode === 'login' ? '/api/login' : '/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      onLogin(data) // the browser now holds the session cookie
    } catch {
      setError('Could not reach the API. Is it running?')
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'signup' : 'login')
    setError('')
  }

  return (
    <main className="app auth">
      <h1>Finance Tracker</h1>
      <h2>{mode === 'login' ? 'Log in' : 'Create an account'}</h2>

      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {mode === 'signup' && <small>At least 8 characters.</small>}
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>

      <p className="auth-switch">
        {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button type="button" className="link" onClick={switchMode}>
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </button>
      </p>
    </main>
  )
}
