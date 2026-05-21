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
| `data/.backups/` | 每次写入前的自动备份 |

`data/` 整个目录已加入 `.gitignore`，不提交到 git。
