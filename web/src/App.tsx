import { useEffect, useRef, useState } from 'react'
import './App.css'
import Login, { type User } from './Login'

// The shape of one transaction, matching the API / database columns.
type Transaction = {
  id: number
  type: 'income' | 'expense'
  amount: number // stored in the smallest unit, e.g. 45000 = 450.00
  category: string
  date: string
  note: string | null
}

// Convert the stored integer (45000) to a readable string ("450.00").
const formatMoney = (amount: number) => (amount / 100).toFixed(2)

const today = () => new Date().toISOString().slice(0, 10)

// The main screen, shown only when someone is logged in.
function Transactions({
  user,
  onLogout,
  onSessionExpired,
}: {
  user: User
  onLogout: () => void
  onSessionExpired: () => void
}) {
  // `useState` holds data that, when changed, makes the screen update.
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null) // null = adding new
  const formRef = useRef<HTMLFormElement>(null) // used to scroll the form into view
  const [month, setMonth] = useState(today().slice(0, 7)) // e.g. "2026-11"; "" = all time

  // Form fields
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')

  // Like fetch, but if the server says we're no longer logged in (401),
  // go back to the login screen.
  async function request(url: string, init?: RequestInit) {
    const res = await fetch(url, init)
    if (res.status === 401) onSessionExpired()
    return res
  }

  // Ask the API for the list and store it in state.
  async function loadTransactions() {
    const res = await request('/api/transactions')
    if (!res.ok) throw new Error('Could not load transactions')
    setTransactions(await res.json())
  }

  // Runs once when the page first loads.
  useEffect(() => {
    loadTransactions().catch(() => setError('Could not reach the API. Is it running?'))
  }, [])

  // Empty the form and leave edit mode.
  function resetForm() {
    setEditingId(null)
    setType('expense')
    setAmount('')
    setCategory('')
    setDate(today())
    setNote('')
  }

  // Load a transaction into the form so it can be changed.
  function startEdit(t: Transaction) {
    setError('')
    setEditingId(t.id)
    setType(t.type)
    setAmount(formatMoney(t.amount))
    setCategory(t.category)
    setDate(t.date)
    setNote(t.note ?? '')
    // On a long list the form can be off screen, so bring it into view.
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Runs when the form is submitted: add a new transaction, or save changes
  // to the one being edited.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const res = await request(
      editingId === null ? '/api/transactions' : `/api/transactions/${editingId}`,
      {
      method: editingId === null ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        amount: Math.round(Number(amount) * 100), // 450.00 -> 45000
        // Reuse an existing spelling if the typed name matches one ignoring case.
        category:
          categories.find((c) => c.toLowerCase() === category.trim().toLowerCase()) ??
          category.trim(),
        date,
        note: note || undefined,
      }),
      },
    )

    if (!res.ok) {
      setError((await res.json()).error)
      return
    }

    // Clear the form and refresh the list.
    if (editingId === null) {
      setAmount('')
      setCategory('')
      setNote('')
    } else {
      resetForm()
    }
    await loadTransactions()
  }

  async function handleDelete(id: number) {
    await request(`/api/transactions/${id}`, { method: 'DELETE' })
    if (id === editingId) resetForm() // don't keep editing a deleted row
    await loadTransactions()
  }

  // Every category used so far (no duplicates, alphabetical), for the suggestions list.
  // Matching ignores case: "Groceries" and "groceries" count as one category,
  // shown with the spelling of the most recent transaction (the list is newest first).
  const categories = (() => {
    const byLowerCase = new Map<string, string>()
    for (const t of transactions) {
      const key = t.category.toLowerCase()
      if (!byLowerCase.has(key)) byLowerCase.set(key, t.category)
    }
    return [...byLowerCase.values()].sort()
  })()

  // Only the transactions in the selected month ("" means show everything).
  // Dates look like "2026-11-14", so a month "2026-11" matches by prefix.
  const visible = month ? transactions.filter((t) => t.date.startsWith(month)) : transactions

  // Totals are calculated from the visible list; no extra API call needed.
  const totalIncome = visible
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0)
  const totalExpenses = visible
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0)
  const balance = totalIncome - totalExpenses

  // Chart data: add up expenses per category and keep only the 3 biggest.
  const TOP_CATEGORIES = 3
  const spendingByCategory = (() => {
    // Group by lowercase name so differently-cased spellings are added together,
    // but show the name the way it appears in the suggestions list.
    const totals = new Map<string, { name: string; total: number }>()
    for (const t of visible) {
      if (t.type !== 'expense') continue
      const key = t.category.toLowerCase()
      const entry = totals.get(key) ?? {
        name: categories.find((c) => c.toLowerCase() === key) ?? t.category,
        total: 0,
      }
      entry.total += t.amount
      totals.set(key, entry)
    }
    return [...totals.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_CATEGORIES)
      .map((e): [string, number] => [e.name, e.total])
  })()
  const biggestCategory = spendingByCategory[0]?.[1] ?? 0

  return (
    <main className="app">
      <header className="topbar">
        <h1>Finance Tracker</h1>
        <div className="account">
          <span>{user.email}</span>
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <div className="filter">
        <label>
          Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" onClick={() => setMonth('')} disabled={month === ''}>
          Show all
        </button>
      </div>

      <section className="summary">
        <div>
          <span className="label">Income</span>
          <strong className="income">{formatMoney(totalIncome)}</strong>
        </div>
        <div>
          <span className="label">Expenses</span>
          <strong className="expense">{formatMoney(totalExpenses)}</strong>
        </div>
        <div>
          <span className="label">Balance</span>
          <strong className={balance < 0 ? 'expense' : 'income'}>{formatMoney(balance)}</strong>
        </div>
      </section>

      {spendingByCategory.length > 0 && (
        <section className="chart" aria-label="Top expense categories">
          <h2>Top {spendingByCategory.length === 1 ? 'expense category' : `${spendingByCategory.length} expense categories`}</h2>
          <ul>
            {spendingByCategory.map(([name, value]) => {
              const share = Math.round((value / totalExpenses) * 100)
              return (
                <li key={name} title={`${name}: ${formatMoney(value)} (${share}% of expenses)`}>
                  <span className="chart-name">{name}</span>
                  <span className="chart-track">
                    <span className="chart-bar" style={{ width: `${(value / biggestCategory) * 100}%` }} />
                  </span>
                  <span className="chart-value">{formatMoney(value)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="form">
        <select value={type} onChange={(e) => setType(e.target.value as 'income' | 'expense')}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          type="number"
          step="0.01"
          min="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <input
          placeholder="Category"
          list="categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        />
        <datalist id="categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit">{editingId === null ? 'Add' : 'Save'}</button>
        {editingId !== null && (
          <button type="button" onClick={resetForm}>
            Cancel
          </button>
        )}
      </form>

      {error && <p className="error">{error}</p>}

      {visible.length === 0 ? (
        <p className="empty">
          {transactions.length === 0
            ? 'No transactions yet. Add your first one above.'
            : 'No transactions in this month.'}
        </p>
      ) : (
        <ul className="list">
          {visible.map((t) => (
            <li key={t.id}>
              <span className="date">{t.date}</span>
              <span className="category">
                {t.category}
                {t.note && <small> — {t.note}</small>}
              </span>
              <span className={`amount ${t.type}`}>
                {t.type === 'income' ? '+' : '-'}
                {formatMoney(t.amount)}
              </span>
              <button onClick={() => startEdit(t)} aria-label="Edit">
                Edit
              </button>
              <button onClick={() => handleDelete(t.id)} aria-label="Delete">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

// Decides what to show: the login screen or the transactions screen.
function App() {
  // undefined = still checking, null = not logged in, otherwise the user.
  const [user, setUser] = useState<User | null | undefined>(undefined)

  // On page load, ask the API whether the browser's cookie is a valid session.
  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' })
    setUser(null)
  }

  if (user === undefined) {
    return (
      <main className="app">
        <p className="empty">Loading…</p>
      </main>
    )
  }
  if (user === null) return <Login onLogin={setUser} />

  return <Transactions user={user} onLogout={handleLogout} onSessionExpired={() => setUser(null)} />
}

export default App
