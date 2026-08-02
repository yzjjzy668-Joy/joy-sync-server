/**
 * Joy 工作台 - 同步后端
 * 账号 + 跨设备实时同步
 *
 * 启动：npm install && npm start
 * 环境变量：JWT_SECRET（生产必改）, PORT（默认 3001）
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
const JWT_EXPIRES = process.env.JWT_EXPIRES || '180d'; // 半年有效
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') && fs.statSync('/data').isDirectory() ? '/data' : __dirname);
const DB_PATH = path.join(DATA_DIR, 'joy.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============ 中间件 ============
app.use(cors({
  origin: true, // 允许任意来源（生产环境建议改成自己的域名）
  credentials: true,
}));
app.use(express.json({ limit: '20mb' }));

// 健康检查
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

const stmts = {
  findUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
  getData: db.prepare('SELECT data_json, updated_at FROM user_data WHERE user_id = ?'),
  insertData: db.prepare('INSERT INTO user_data (user_id, data_json, updated_at) VALUES (?, ?, ?)'),
  updateData: db.prepare('UPDATE user_data SET data_json = ?, updated_at = ? WHERE user_id = ?'),
};

// ============ 工具 ============
function genToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权：请先登录' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, username: payload.username };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 简单请求日志
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t;
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// ============ 路由 ============

// 注册
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码必填' });
    }
    const uname = String(username).trim().toLowerCase();
    if (uname.length < 3 || uname.length > 30) {
      return res.status(400).json({ error: '用户名需 3-30 个字符' });
    }
    if (!/^[a-z0-9_\-.]+$/.test(uname)) {
      return res.status(400).json({ error: '用户名只能包含小写字母、数字、_ - .' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    if (stmts.findUserByName.get(uname)) {
      return res.status(400).json({ error: '该用户名已被注册' });
    }
    const hash = await bcrypt.hash(password, 10);
    const r = stmts.insertUser.run(uname, hash, Date.now());
    const user = { id: r.lastInsertRowid, username: uname };
    const token = genToken(user);
    res.json({ ok: true, token, user });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: '注册失败：' + e.message });
  }
});

// 登录
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码必填' });
    }
    const uname = String(username).trim().toLowerCase();
    const row = stmts.findUserByName.get(uname);
    if (!row) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const user = { id: row.id, username: row.username };
    const token = genToken(user);
    res.json({ ok: true, token, user });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: '登录失败：' + e.message });
  }
});

// 当前用户信息
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// 拉取数据
app.get('/api/data', authMiddleware, (req, res) => {
  const row = stmts.getData.get(req.user.id);
  if (!row) {
    return res.json({ data: null, updatedAt: 0 });
  }
  try {
    const data = JSON.parse(row.data_json);
    res.json({ data, updatedAt: row.updated_at });
  } catch (e) {
    console.error('data parse error for user', req.user.id, e);
    res.status(500).json({ error: '数据解析失败' });
  }
});

// 推送数据
app.put('/api/data', authMiddleware, (req, res) => {
  const { data, clientUpdatedAt } = req.body || {};
  if (data === undefined) {
    return res.status(400).json({ error: 'data 必填' });
  }
  const now = Date.now();
  let json;
  try {
    json = JSON.stringify(data);
  } catch (e) {
    return res.status(400).json({ error: 'data 必须是可 JSON 序列化的对象' });
  }
  const existing = stmts.getData.get(req.user.id);
  if (existing) {
    stmts.updateData.run(json, now, req.user.id);
  } else {
    stmts.insertData.run(req.user.id, json, now);
  }
  res.json({ ok: true, updatedAt: now, clientUpdatedAt: clientUpdatedAt || 0 });
});

// 改密（暂未启用，留接口）
app.post('/api/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '旧密码和新密码必填' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row) return res.status(404).json({ error: '用户不存在' });
    const ok = await bcrypt.compare(String(oldPassword), row.password_hash);
    if (!ok) return res.status(401).json({ error: '旧密码错误' });
    const newHash = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE password_hash = ? WHERE id = ?').run(newHash, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 全局错误兜底
app.use((err, req, res, next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Joy 工作台同步服务已启动`);
  console.log(`   监听端口：${PORT}`);
  console.log(`   数据库：${DB_PATH}`);
  console.log(`   JWT 有效期：${JWT_EXPIRES}`);
});
