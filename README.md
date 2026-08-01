# Joy 工作台 · 云端同步后端

> 账号密码登录 + 电脑/手机实时同步数据
> 前端：`joy-workbench/index.html`（部署到 CloudStudio 等静态托管）
> 后端：本目录（Node.js + SQLite + JWT）

---

## 一、怎么用（用户视角）

1. 打开工作台网址（手机/电脑都打开同一个网址）
2. 第一次进来会让你**注册**一个账号（用户名 + 密码）
3. 注册/登录后，数据自动存到云端
4. 在手机上改一下，电脑上**15 秒内**自动同步；反之亦然
5. 侧边栏底部能看到同步状态（☁️ 已同步 / ⚠️ 离线 / ❌ 失败）

---

## 二、部署后端（必做，否则手机连不到电脑）

前端在云端，但后端需要单独部署到一个**公网地址**。推荐 **Render.com**（免费、5 分钟、不用信用卡）。

### 方式 A：一键部署（最简单）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/你的用户名/joy-workbench)

> 需要先把本目录推到你的 GitHub 仓库，再把上面按钮里的仓库地址改成你的。

### 方式 B：手动部署（5 分钟）

1. 注册 [render.com](https://render.com)（用 GitHub 登录最快）
2. **New → Blueprint**，连你的 GitHub，选包含本目录的仓库
3. Render 会自动读 `render.yaml`，直接点 **Apply**
4. 等 2-3 分钟，拿到地址如 `https://joy-workbench-server-xxx.onrender.com`
5. 打开这个地址 + `/api/health`，看到 `{"ok":true,...}` 就算成功

### 方式 C：在你自己电脑上跑（不用上云，但要开机）

```bash
cd joy-workbench-server
npm install
JWT_SECRET=随便一长串 node server.js
# 然后用 cloudflared / ngrok 把 3001 端口暴露到公网
# cloudflared tunnel --url http://localhost:3001
```

---

## 三、把前端指向你的后端

打开工作台 → 登录页底部点 **「同步服务器地址（高级）」** → 粘贴你的后端地址
（如 `https://joy-workbench-server-xxx.onrender.com`）→ 自动保存。

之后所有设备都填同一个地址，就能共享数据了。

---

## 四、本地开发测试

```bash
cd joy-workbench-server
npm install
JWT_SECRET=dev123 PORT=3001 node server.js
# 前端 index.html 里把 API 地址填 http://localhost:3001
```

测试接口：
```bash
curl -X POST http://localhost:3001/api/register -H "Content-Type: application/json" -d '{"username":"test","password":"123456"}'
```

---

## 五、安全 & 注意

- **JWT_SECRET 务必改**（Render 一键部署会自动生成）
- 数据存在 SQLite 单文件 `joy.db`，Render 已挂载持久盘 `/data`
- 免费版 15 分钟无访问会休眠，下次打开慢约 30 秒（正常）
- 定期备份 `joy.db`（WorkBuddy AI 不负责数据丢失）
- 多设备同时离线编辑后联网：以**最后保存的一方**为准（last-write-wins）
