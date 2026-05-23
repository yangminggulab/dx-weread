# 任务管理 App

任务、日记、微信读书三合一的个人面板，支持本地服务器和云端同时运行。

## 模块结构

```
sync/          同步脚本（微信读书 API 同步、云端推送等 Python 脚本）
data/          运行时数据文件（gitignore，不提交）
web/           本地 Flask 服务器 + dashboard.html 网页源码
worker/        Cloudflare Worker（云端 API，小程序调这里）
miniprogram/   微信小程序（Taro）
```

## 数据流

```
微信读书 API
      │
      ▼
web/services/weread_sync.py      ← Flask 后台，每 2 小时自动跑
sync/sync_weread.py              ← 手动命令行脚本
      │ 两者都写
      ▼
data/weread_data.json
data/weread_notes.json
data/time.json
data/tasks.json
data/diary.json
local_backups/
      │
      ├──→ 推送 ──→ Cloudflare Worker KV ──→ 小程序读取
      │
      └──→ web/server.py 本地读取 ──→ 浏览器 localhost:8080
```

**写入规则：**

| 操作 | 写哪里 | 推云端？ |
|---|---|---|
| 网页改任务/日记 | 本地 `data/` | ❌ 不推 |
| WeRead 同步 | 本地 `data/` | ✅ 自动推 |
| 凌晨 5 点重置 | 本地 `data/` | ✅ 自动推 |
| 云端 pull（每 15 分钟） | 本地 `data/` | — |

**云端 Worker 独立运行的部分（不依赖本地）：**
- 小程序直接调 Worker API 读写云端 KV
- Worker Cron 每 3 小时自动同步微信读书（需配置 `WEREAD_API_KEY` secret）
- Worker Cron 凌晨 5 点重置已完成任务

## 本地运行

```bash
pip install -r requirements.txt
python3 web/server.py
```

访问 `http://localhost:8080`

配置项放在根目录 `.env`：

```env
WEREAD_API_KEY=wrk-你的key
API_TOKEN=你的云端token
CLOUD_BASE_URL=https://yangminggu.com/tasks
```

## 云端部署（Cloudflare Worker）

```bash
cd worker
npm install
npm run deploy
```

需要在 Cloudflare 控制台配置 Secrets：`API_TOKEN`、`WEREAD_API_KEY`

## 数据文件

| 文件 | 内容 |
|---|---|
| `data/tasks.json` | 任务数据 |
| `data/diary.json` | 日记 |
| `data/time.json` | 时间模块数据，目前包含 `weread` 阅读时长 |
| `data/weread_data.json` | 微信读书书架、统计 |
| `data/weread_notes.json` | 微信读书笔记 |
| `local_backups/` | 每次写入前的本地自动备份 |

`data/` 整个目录已加入 `.gitignore`，不提交到 git。

## 逐文件职责清单（供 AI / 开发者快速定位）

### `web/` — 本地 Flask 服务器

| 文件 | 职责 |
|---|---|
| `web/server.py` | Flask 入口，注册路由和定时任务，启动服务器 |
| `web/dashboard.html` | 浏览器端 UI（任务/日记/读书面板），包含内联 Vue.js 组件和样式 |
| `web/routes/api.py` | 所有 REST API 路由（任务 CRUD、日记读写、微信读书数据查询、云端推送/pull） |
| `web/services/storage.py` | 通用数据清洗/标准化工具函数 |
| `web/services/json_store.py` | 通用 JSON 文件读写（含自动备份到 `local_backups/`） |
| `web/services/tasks_store.py` | 任务数据的持久化层 |
| `web/services/diary_store.py` | 日记数据的持久化层 |
| `web/services/time_store.py` | 时间模块数据（阅读时长等）持久化层 |
| `web/services/weread_store.py` | 微信读书书架/统计数据持久化层 |
| `web/services/weread_sync.py` | 微信读书 API 同步逻辑（书籍、笔记、阅读时长） |
| `web/services/weread_stats.py` | 微信读书统计计算（阅读趋势、周报等） |
| `web/services/cloud_sync.py` | 云端 Worker KV 的推送/拉取逻辑 |
| `web/services/config.py` | 环境变量读取和配置 |

### `miniprogram/` — Taro 微信小程序

> **注意：源码在 `src/`，编译输出在 `dist/`。改 UI 只改 `src/`，不要改 `dist/`。**

| 文件 | 职责 |
|---|---|
| `src/app.js` | 小程序入口 |
| `src/app.config.js` | 小程序配置（页面路由、tabBar） |
| `src/app.scss` | 全局样式 |
| `src/config.js` | 前端配置（API 地址等） |
| `src/api/index.js` | 封装所有云端 API 调用（getData、addTask、updateTask 等） |
| `src/pages/index/index.jsx` | **任务 + 日记主页面**（左右滑动的双面板 UI） |
| `src/pages/index/index.scss` | 任务/日记页面样式 |
| `src/pages/books/index.jsx` | **微信读书书架页面** |
| `src/pages/books/index.scss` | 书架页面样式 |
| `src/pages/notes/index.jsx` | **微信读书笔记页面** |
| `src/pages/notes/index.scss` | 笔记页面样式 |

### `worker/` — Cloudflare Worker

| 文件 | 职责 |
|---|---|
| `src/index.js` | Worker 全部逻辑（KV 读写 API、定时任务同步微信读书、凌晨重置任务） |

### `sync/` — 命令行同步脚本

| 文件 | 职责 |
|---|---|
| `sync/sync_weread.py` | 手动触发微信读书同步 |
| `sync/weread_env.py` | 微信读书 API 认证环境变量配置 |
| `sync/weread/service.py` | 微信读书 API 封装（wasm 解密、请求签名） |
| `sync/backup_bookshelf.py` | 书架数据备份 |
| `sync/export_notes.py` | 导出笔记 |
| `sync/github_actions_secrets.py` | GitHub Actions Secrets 管理 |

### `tests/` — 测试

| 文件 | 职责 |
|---|---|
| `tests/test_diary_store.py` | 日记持久化层测试 |
| `tests/test_time_store.py` | 时间数据持久化层测试 |
| `tests/test_weread_store.py` | 读书数据持久化层测试 |
| `tests/test_weread_stats.py` | 读书统计计算测试 |
| `tests/test_weread_service_stats.py` | 读书 API 服务统计测试 |

## 快速定位：我要改…

| 需求 | 改哪里 |
|---|---|
| 修改小程序的任务/日记 UI | `miniprogram/src/pages/index/index.jsx` + `index.scss` |
| 修改小程序的读书书架 UI | `miniprogram/src/pages/books/index.jsx` + `index.scss` |
| 修改小程序的读书笔记 UI | `miniprogram/src/pages/notes/index.jsx` + `index.scss` |
| 添加/修改小程序 API 调用 | `miniprogram/src/api/index.js` |
| 修改网页端 UI (dashboard) | `web/dashboard.html` |
| 添加/修改后端 API 接口 | `web/routes/api.py` |
| 修改任务数据存储逻辑 | `web/services/tasks_store.py` |
| 修改日记存储逻辑 | `web/services/diary_store.py` |
| 修改微信读书同步逻辑 | `web/services/weread_sync.py` |
| 修改微信读书统计计算 | `web/services/weread_stats.py` |
| 修改云端推送/拉取 | `web/services/cloud_sync.py` |
| 修改 Cloudflare Worker 逻辑 | `worker/src/index.js` |
| 修改通用 JSON 存储/备份 | `web/services/json_store.py` |
| 修改定时任务（Flask 端） | `web/server.py` |
| 修改小程序全局配置/tabBar | `miniprogram/src/app.config.js` |
| 修改小程序全局样式 | `miniprogram/src/app.scss` |
| 修改微信读书 API 调用底层 | `sync/weread/service.py` |

