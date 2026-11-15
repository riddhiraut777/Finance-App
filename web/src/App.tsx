import { useEffect, useState } from 'react'
import './App.css'

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

function App() {
  // `useState` holds data that, when changed, makes the screen update.
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [error, setError] = useState('')

  // Form fields
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')

  // Ask the API for the list and store it in state.
  async function loadTransactions() {
    const res = await fetch('/api/transactions')
    setTransactions(await res.json())
  }

  // Runs once when the page first loads.
  useEffect(() => {
    loadTransactions().catch(() => setError('Could not reach the API. Is it running?'))
  }, [])

  // Runs when the form is submitted: send the new transaction to the API.
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        amount: Math.round(Number(amount) * 100), // 450.00 -> 45000
        category,
        date,
        note: note || undefined,
      }),
    })

    if (!res.ok) {
      setError((await res.json()).error)
      return
    }

    // Clear the form and refresh the list.
    setAmount('')
    setCategory('')
    setNote('')
    await loadTransactions()
  }

  async function handleDelete(id: number) {
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
    await loadTransactions()
  }

  return (
    <main className="app">
      <h1>Finance Tracker</h1>

      <form onSubmit={handleAdd} className="form">
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
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit">Add</button>
      </form>

      {error && <p className="error">{error}</p>}

      {transactions.length === 0 ? (
        <p className="empty">No transactions yet. Add your first one above.</p>
      ) : (
        <ul className="list">
          {transactions.map((t) => (
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

export default App
