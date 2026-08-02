/**
 * Joy 工作台 - 同步后端
 * 账号 + 跨设备实时同步
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();

// ============ 配置 ============
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'joy-dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '180d';
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') && fs.statSync('/data').isDirectory() ? '/data' : __dirname);
const DB_PATH = path.join(DATA_DIR, 'joy.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============ 中间件 ============
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now(), service: 'joy-workbench' });
});

// ============ 数据库 ============
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ============ 路由：注册 ============
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (username.length < 2 || username.length > 32) {
      return res.status(400).json({ error: '用户名长度需在 2-32 之间' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: '用户名已被注册' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    ).run(username, password_hash, Date.now());
    const userId = result.lastInsertRowid;
    const token = jwt.sign({ uid: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ ok: true, token, user: { id: userId, username } });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: '注册失败：' + (err.message || '未知错误') });
  }
});

// ============ 路由：登录 ============
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ ok: true, token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: '登录失败：' + (err.message || '未知错误') });
  }
});

// ============ 路由：当前用户 ============
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ ok: true, user: req.user });
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.uid, username: payload.username };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// ============ 路由：拉取数据 ============
app.get('/api/data', authMiddleware, (req, res) => {
  try {
    const row = db.prepare('SELECT data_json, updated_at FROM user_data WHERE user_id = ?').get(req.user.id);
    if (!row) {
      return res.json({ ok: true, data: null, updated_at: 0 });
    }
    res.json({ ok: true, data: JSON.parse(row.data_json), updated_at: row.updated_at });
  } catch (err) {
    console.error('get data error:', err);
    res.status(500).json({ error: '读取失败：' + (err.message || '未知错误') });
  }
});

// ============ 路由：保存数据 ============
app.put('/api/data', authMiddleware, (req, res) => {
  try {
    const { data } = req.body || {};
    if (data == null) {
      return res.status(400).json({ error: '数据不能为空' });
    }
    const json = JSON.stringify(data);
    const now = Date.now();
    const existing = db.prepare('SELECT user_id FROM user_data WHERE user_id = ?').get(req.user.id);
    if (existing) {
      db.prepare('UPDATE user_data SET data_json = ?, updated_at = ? WHERE user_id = ?').run(json, now, req.user.id);
    } else {
      db.prepare('INSERT INTO user_data (user_id, data_json, updated_at) VALUES (?, ?, ?)').run(req.user.id, json, now);
    }
    res.json({ ok: true, updated_at: now });
  } catch (err) {
    console.error('put data error:', err);
    res.status(500).json({ error: '保存失败：' + (err.message || '未知错误') });
  }
});

// ============ 启动 ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Joy 同步服务已启动 → http://0.0.0.0:${PORT}`);
  console.log(`健康检查:        http://0.0.0.0:${PORT}/api/health`);
  console.log(`数据库位置:      ${DB_PATH}`);
