// Demo app Express — đối tượng deploy/thí nghiệm của OpsPilot (M12).
// Chỉ là công cụ thí nghiệm: endpoint fault bật trong các phiên đo, không phải lỗ hổng.
const express = require('express')
const { Pool } = require('pg')
const path = require('path')
const { version: APP_VERSION } = require('./package.json')

const PORT = Number(process.env.PORT || 3000)
const DATABASE_URL = process.env.DATABASE_URL || ''
const SEED_COUNT = 1000

const app = express()
app.use(express.json())
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

// Đồng hồ khởi động để hiện trong /health.
const startedAt = Date.now()

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime_s: Math.round((Date.now() - startedAt) / 1000) })
})

app.get('/favicon.ico', (_req, res) => res.status(204).end())

app.get('/meta', async (_req, res, next) => {
  try {
    const { total } = await listItems(1, 0)
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
    const { items, total } = await listItems(limit, offset)
    res.set('X-Total-Count', String(total))
    res.json(items)
  } catch (error) {
    next(error)
  }
})

app.get('/items/:id', async (req, res, next) => {
  try {
    const item = await getItem(Number(req.params.id))
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
    res.status(201).json(await createItem(name))
  } catch (error) {
    next(error)
  }
})

app.put('/items/:id', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'thieu truong name' })
    const item = await updateItem(Number(req.params.id), name)
    if (!item) return res.status(404).json({ error: 'khong tim thay' })
    res.json(item)
  } catch (error) {
    next(error)
  }
})

app.delete('/items/:id', async (req, res, next) => {
  try {
    const ok = await deleteItem(Number(req.params.id))
    if (!ok) return res.status(404).json({ error: 'khong tim thay' })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
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
