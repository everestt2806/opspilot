// Demo SPA (M12) — trang duy nhất: gọi /health và /items của VITE_API_URL,
// hiển thị trạng thái để nghiệm thu deploy SPA tĩnh trên VPS.
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

const API_URL = import.meta.env.VITE_API_URL || ''

function App() {
  const [health, setHealth] = useState('dang tai...')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setHealth(`OK — uptime ${j.uptime_s}s`))
      .catch((e) => {
        setHealth('LOI')
        setError(String(e.message))
      })
    fetch(`${API_URL}/items?limit=5`)
      .then(async (r) => ({ total: r.headers.get('X-Total-Count') || '?', body: await r.json() }))
      .then(({ total, body }) => setItems({ total, names: body.map((x) => x.name) }))
      .catch((e) => setError(String(e.message)))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 560, margin: '3rem auto', padding: '0 1rem' }}>
      <h1>OpsPilot Demo SPA</h1>
      <p>Demo React + Vite — đối tượng deploy của OpsPilot (M12).</p>
      <ul>
        <li>
          API health: <strong>{health}</strong>
        </li>
        <li>
          API items: {items ? `${items.names.length} bản ghi / tổng ${items.total}` : 'dang tai...'}
        </li>
        {items && <li>Mẫu: {items.names.join(', ')}</li>}
        {error && <li style={{ color: '#c00' }}>Lỗi: {error}</li>}
      </ul>
    </main>
  )
}

export default App

createRoot(document.getElementById('root')).render(<App />)
