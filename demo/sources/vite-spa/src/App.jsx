// Demo SPA (M12) — trang duy nhất: gọi /health và /items của VITE_API_URL,
// hiển thị trạng thái để nghiệm thu deploy SPA tĩnh trên VPS.
import React, { useCallback, useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

function formatUptime(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  return hours > 0
    ? `${hours}h ${minutes}m`
    : minutes > 0
      ? `${minutes}m ${secs}s`
      : `${secs}s`
}

function App() {
  const [health, setHealth] = useState(null)
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const healthResponse = await fetch(`${API_URL}/health`)
      if (!healthResponse.ok) throw new Error(`GET /health → HTTP ${healthResponse.status}`)
      setHealth(await healthResponse.json())

      const itemsResponse = await fetch(`${API_URL}/items?limit=5`)
      if (!itemsResponse.ok) throw new Error(`GET /items → HTTP ${itemsResponse.status}`)
      setItems({
        total: itemsResponse.headers.get('X-Total-Count') || '?',
        body: await itemsResponse.json()
      })
    } catch (e) {
      setError(String(e.message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const statusLine = error
    ? { className: 'status-line bad', text: 'Không kết nối được API' }
    : loading && !health
      ? { className: 'status-line pending', text: 'Đang kiểm tra…' }
      : health?.ok
        ? { className: 'status-line ok', text: 'API health: OK' }
        : { className: 'status-line bad', text: 'API health: DEGRADED' }

  return (
    <>
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 15.5 12 4l7 11.5-7 4.5-7-4.5Z" stroke="currentColor" strokeWidth="1.7" />
              <path d="M8.5 14.8h7M12 4v16" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </span>
          <span>OpsPilot Demo SPA</span>
        </div>
        <span className="topbar-note" title={API_URL}>
          {API_URL || 'VITE_API_URL chưa set'}
        </span>
      </nav>

      <main className="page">
        <section className="page-heading">
          <h1>Kiểm tra kết nối API</h1>
          <p>
            SPA tĩnh build bằng Vite và phục vụ bởi Nginx. Biến <code>VITE_API_URL</code> được đóng
            vào bundle lúc build — trang này gọi trực tiếp Express API trên VPS.
          </p>
          <div className="refresh-row">
            <span className="endpoint">{API_URL}/health · {API_URL}/items</span>
            <button className="refresh-button" type="button" onClick={refresh} disabled={loading}>
              {loading ? 'Đang tải…' : 'Kiểm tra lại'}
            </button>
          </div>
        </section>

        {error && (
          <div className="error-banner">
            Lỗi: <code>{error}</code>
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <h2>Trạng thái API</h2>
            <span>GET /health</span>
          </div>
          <div className="card-body">
            <div className={statusLine.className}>
              <span className="status-dot" aria-hidden="true" />
              {statusLine.text}
            </div>
            <div className="detail-grid">
              <div>
                <span className="detail-label">Uptime</span>
                <span className="detail-value">
                  {health ? formatUptime(health.uptime_s) : '—'}
                </span>
              </div>
              <div>
                <span className="detail-label">Trạng thái</span>
                <span className="detail-value">{health ? (health.ok ? 'ok' : 'degraded') : '—'}</span>
              </div>
              <div>
                <span className="detail-label">Endpoint</span>
                <span className="detail-value">/health</span>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Dữ liệu từ API</h2>
            <span>GET /items?limit=5 · X-Total-Count</span>
          </div>
          <div className="card-body">
            {items ? (
              <>
                <span className="detail-label">Tổng số bản ghi</span>
                <span className="detail-value" style={{ fontSize: 20 }}>
                  {items.total}
                </span>
                <ul className="sample-list" style={{ marginTop: 12 }}>
                  {items.body.map((item) => (
                    <li key={item.id}>
                      <span>{item.name}</span>
                      <span className="sample-id">#{item.id}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty-note">{loading ? 'Đang tải…' : 'Chưa có dữ liệu.'}</p>
            )}
          </div>
        </section>
      </main>

      <footer className="page">Deploy bởi OpsPilot · React · Vite · Nginx</footer>
    </>
  )
}

export default App
