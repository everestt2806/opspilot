// Demo app Express — đối tượng deploy/thí nghiệm của OpsPilot (M12).
// Chỉ là công cụ thí nghiệm: endpoint fault bật trong các phiên đo, không phải lỗ hổng.
const express = require('express')
const { Pool } = require('pg')
const path = require('path')
const { version: APP_VERSION } = require('./package.json')

const PORT = Number(process.env.PORT || 3000)
const DATABASE_URL = process.env.DATABASE_URL || ''
const SEED_COUNT = 1000
// Fault chỉ hoạt động khi ENABLE_FAULT_ENDPOINTS=true — mặc định tắt (M12 tuần 6).
const FAULT_ENABLED = process.env.ENABLE_FAULT_ENDPOINTS === 'true'

const app = express()
app.use(express.json())
// Vite demo runs on a different public port, so allow its browser requests and
// expose the count header used by the UI. This demo API does not use cookies.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.static(path.join(__dirname, 'public')))

// ── Lớp lưu trữ ──────────────────────────────────────────────────────────────
// Có DATABASE_URL thì dùng PostgreSQL (migration + seed 1000 bản ghi); không có thì
// rơi về bộ nhớ để app chạy độc lập, không phụ thuộc dịch vụ ngoài (ràng buộc M12).
let memoryItems = null
let pool = null
let usingDb = false

async function migrateAndSeed() {
  await pool.query(`CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM items')
  if (rows[0].n === 0) {
    const placeholders = Array.from({ length: SEED_COUNT }, (_, i) => `('khoan-thu-${i + 1}')`).join(',')
    await pool.query(`INSERT INTO items (name) VALUES ${placeholders}`)
    console.log(`[seed] da chen ${SEED_COUNT} ban ghi vao PostgreSQL`)
  }
}

async function initStorage() {
  if (DATABASE_URL) {
    pool = new Pool({ connectionString: DATABASE_URL })
    await pool.query('SELECT 1')
    usingDb = true
    await migrateAndSeed()
    console.log('[db] dung PostgreSQL')
  } else {
    memoryItems = Array.from({ length: SEED_COUNT }, (_, i) => ({
      id: i + 1,
      name: `khoan-thu-${i + 1}`,
      created_at: new Date().toISOString()
    }))
    console.log(`[db] khong co DATABASE_URL — dung bo nho, ${SEED_COUNT} ban ghi`)
  }
}

async function listItems(limit, offset) {
  if (usingDb) {
    const [rows, count] = await Promise.all([
      pool.query('SELECT * FROM items ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT count(*)::int AS n FROM items')
    ])
    return { items: rows.rows, total: count.rows[0].n }
  }
  return { items: memoryItems.slice(offset, offset + limit), total: memoryItems.length }
}

async function getItem(id) {
  if (usingDb) {
    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id])
    return rows[0] || null
  }
  return memoryItems.find((item) => item.id === id) || null
}

async function createItem(name) {
  if (usingDb) {
    const { rows } = await pool.query('INSERT INTO items (name) VALUES ($1) RETURNING *', [name])
    return rows[0]
  }
  const item = { id: memoryItems.length + 1, name, created_at: new Date().toISOString() }
  memoryItems.push(item)
  return item
}

async function updateItem(id, name) {
  if (usingDb) {
    const { rows } = await pool.query('UPDATE items SET name = $1 WHERE id = $2 RETURNING *', [name, id])
    return rows[0] || null
  }
  const item = memoryItems.find((i) => i.id === id)
  if (!item) return null
  item.name = name
  return item
}

async function deleteItem(id) {
  if (usingDb) {
    const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id])
    return rowCount > 0
  }
  const index = memoryItems.findIndex((i) => i.id === id)
  if (index === -1) return false
  memoryItems.splice(index, 1)
  return true
}

// ── Trạng thái fault (tuần 6, M12) ───────────────────────────────────────────
// Mỗi hiệu ứng độc lập, bật/tắt riêng; POST /debug/reset xoá sạch tất cả.
// /health KHÔNG đi qua middleware fault — health check nhị phân vẫn xanh khi app
// đang suy giảm: đây chính là kịch bản OpsPilot cần phát hiện (điểm mấu chốt đồ án).
const faultState = {
  leakBuffers: [],          // /debug/leak — giữ tham chiếu, GC không thu được
  cpuBusyMs: 0,             // /debug/cpu — busy-loop mỗi request
  errorRate: 0,             // /debug/error-rate — xác suất trả 500
  slowDbSec: 0,             // /debug/slow-db — pg_sleep trước mỗi query (chỉ chế độ DB)
  latencyMs: 0              // /debug/latency — delay mọi request (trừ /health)
}

function faultSummary() {
  return {
    leak_mb: faultState.leakBuffers.length * 5,
    cpu_busy_ms: faultState.cpuBusyMs,
    error_rate: faultState.errorRate,
    slow_db_sec: faultState.slowDbSec,
    latency_ms: faultState.latencyMs
  }
}

function clampFault(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(num, min), max)
}

// Middleware fault. /health, /favicon và toàn bộ /debug/* được miễn nhiễm NGAY TẠI ĐÂY:
// health check nhị phân vẫn 200 + nhanh khi app đang suy giảm — đây chính là kịch bản
// OpsPilot cần phát hiện (ràng buộc M12); còn /debug/* là bảng điều khiển fault, phải luôn
// dùng được để tắt hiệu ứng (kể cả khi error-rate=1.0).
// Chỉ gắn ràng buộc khi ENABLE_FAULT_ENDPOINTS=true để bản chạy thường không treo request.
function isFaultExempt(path) {
  return path === '/health' || path === '/favicon.ico' || path.startsWith('/debug')
}

app.use((req, res, next) => {
  if (!FAULT_ENABLED) return next()
  if (isFaultExempt(req.path)) return next()
  // error-rate: quay số ngẫu nhiên mỗi request
  if (faultState.errorRate > 0 && Math.random() < faultState.errorRate) {
    return res.status(500).json({ error: 'fault error-rate' })
  }
  // latency: delay mọi request trừ các path miễn nhiễm ở trên
  const delay = faultState.latencyMs
  const busy = faultState.cpuBusyMs
  const run = () => {
    // cpu: busy-loop chặn event loop đúng `ms` mili-giây
    if (busy > 0) {
      const end = Date.now() + busy
      while (Date.now() < end) { /* churn CPU */ }
    }
    next()
  }
  return delay > 0 ? setTimeout(run, delay) : run()
})

// Wrapper slow-db cho các hàm query: chèn pg_sleep trước mỗi truy vấn.
async function withSlowDb(fn) {
  if (FAULT_ENABLED && usingDb && faultState.slowDbSec > 0) {
    await pool.query(`SELECT pg_sleep(${faultState.slowDbSec})`)
  }
  return fn()
}

// Đồng hồ khởi động để hiện trong /health.
const startedAt = Date.now()

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime_s: Math.round((Date.now() - startedAt) / 1000) })
})

app.get('/favicon.ico', (_req, res) => res.status(204).end())

app.get('/meta', async (_req, res, next) => {
  try {
    const { total } = await withSlowDb(() => listItems(1, 0))
    res.json({
      service: 'OpsPilot Demo Inventory',
      version: APP_VERSION,
      status: 'online',
      runtime: process.version,
      storage: usingDb ? 'PostgreSQL' : 'In-memory fallback',
      records: total,
      started_at: new Date(startedAt).toISOString(),
      uptime_s: Math.round((Date.now() - startedAt) / 1000)
    })
  } catch (error) {
    next(error)
  }
})

app.get('/items', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 1000)
    const offset = Math.max(Number(req.query.offset || 0), 0)
    const { items, total } = await withSlowDb(() => listItems(limit, offset))
    res.set('X-Total-Count', String(total))
    res.json(items)
  } catch (error) {
    next(error)
  }
})

app.get('/items/:id', async (req, res, next) => {
  try {
    const item = await withSlowDb(() => getItem(Number(req.params.id)))
    if (!item) return res.status(404).json({ error: 'khong tim thay' })
    res.json(item)
  } catch (error) {
    next(error)
  }
})

app.post('/items', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'thieu truong name' })
    res.status(201).json(await withSlowDb(() => createItem(name)))
  } catch (error) {
    next(error)
  }
})

app.put('/items/:id', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'thieu truong name' })
    const item = await withSlowDb(() => updateItem(Number(req.params.id), name))
    if (!item) return res.status(404).json({ error: 'khong tim thay' })
    res.json(item)
  } catch (error) {
    next(error)
  }
})

app.delete('/items/:id', async (req, res, next) => {
  try {
    const ok = await withSlowDb(() => deleteItem(Number(req.params.id)))
    if (!ok) return res.status(404).json({ error: 'khong tim thay' })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

// ── Fault endpoint (M12 tuần 6) — công cụ thí nghiệm, không phải lỗ hổng ──────
// Chỉ hoạt động khi ENABLE_FAULT_ENDPOINTS=true. Không bật = các route dưới trả 404
// để bản chạy demo thường không lộ gì thêm.
function guardFault(req, res, next) {
  if (!FAULT_ENABLED) {
    return res.status(404).json({ error: 'fault endpoint tat (ENABLE_FAULT_ENDPOINTS!=true)' })
  }
  next()
}

app.get('/debug/status', guardFault, (_req, res) => {
  res.json({ enabled: FAULT_ENABLED, ...faultSummary() })
})

// Cấp phát mb MB và giữ trong mảng toàn cục — GC không thu được, mem_mb tăng tuyến
// tính giữa các lần lặp (đối tượng của kịch bản memory leak, docs/07).
app.get('/debug/leak', guardFault, (req, res) => {
  const mb = clampFault(req.query.mb, 1, 512, 5)
  faultState.leakBuffers.push(Buffer.alloc(mb * 1024 * 1024, 0x61))
  res.json({ ok: true, leak_mb: faultState.leakBuffers.length * mb, chunks: faultState.leakBuffers.length })
})

// Busy-loop chặn ms mili-giây (20–400) — cpu_pct tăng vọt khi load_gen gọi liên tục.
app.get('/debug/cpu', guardFault, (req, res) => {
  faultState.cpuBusyMs = clampFault(req.query.ms, 20, 400, 200)
  res.json({ ok: true, cpu_busy_ms: faultState.cpuBusyMs })
})

// Xác suất (0–1) mọi request tiếp theo trả HTTP 500 — http_error_rate tăng.
app.get('/debug/error-rate', guardFault, (req, res) => {
  faultState.errorRate = clampFault(req.query.p, 0, 1, 0.3)
  res.json({ ok: true, error_rate: faultState.errorRate })
})

// Chèn SELECT pg_sleep(sec) (0–1.5) trước mỗi query — chỉ có tác dụng khi chạy DB.
app.get('/debug/slow-db', guardFault, (req, res) => {
  faultState.slowDbSec = clampFault(req.query.sec, 0, 1.5, 0.5)
  res.json({ ok: true, slow_db_sec: faultState.slowDbSec, storage: usingDb ? 'PostgreSQL' : 'in-memory (khong co tac dung)' })
})

// Middleware delay ms (0–2500) cho mọi request trừ /health — latency_ms tăng.
app.get('/debug/latency', guardFault, (req, res) => {
  faultState.latencyMs = clampFault(req.query.ms, 0, 2500, 500)
  res.json({ ok: true, latency_ms: faultState.latencyMs })
})

// Xoá mọi hiệu ứng, giải phóng mảng leak.
app.post('/debug/reset', guardFault, (_req, res) => {
  faultState.leakBuffers.length = 0
  faultState.cpuBusyMs = 0
  faultState.errorRate = 0
  faultState.slowDbSec = 0
  faultState.latencyMs = 0
  res.json({ ok: true, ...faultSummary() })
})

app.use((error, _req, res, _next) => {
  console.error('[loi]', error)
  res.status(500).json({ error: 'loi may chu' })
})

initStorage()
  .then(() => {
    app.listen(PORT, () => console.log(`[start] express-api dang nghe cong ${PORT}`))
  })
  .catch((error) => {
    console.error('Khoi dong storage that bai:', error)
    process.exit(1)
  })
