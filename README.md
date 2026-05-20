# dx-weread

一个本地优先的任务管理面板，已经接入微信读书同步，支持把书架、最近阅读动态和读书笔记放进同一个 Dashboard 里。

## 现在能做什么

- 管理日常任务、每周任务和长期任务
- 展示学习书架与微信读书书架
- 从微信读书同步最近阅读、划线、高亮和评论
- 把微信读书笔记单独存到本地文件，和主业务数据分开
- 用本机 `WEREAD_API_KEY` 直接调用微信读书网关同步
- 把同步结果继续合并回现有 Dashboard 和小程序数据视图

## 本地运行

### 1. 安装依赖

```bash
python3 -m pip install -r requirements.txt
```

### 2. 启动服务

```bash
python3 server.py
```

默认访问地址：

- `http://127.0.0.1:8080`
- `http://localhost:8080/dashboard.html`

如果后面要挂到自己的服务器上，可以用环境变量改监听地址：

```bash
TASK_APP_HOST=0.0.0.0 TASK_APP_PORT=8080 python3 server.py
```

## 微信读书同步方式

### 纯本地自动同步（推荐）

如果你的目标是“只在这台 Mac 上稳定自动同步”，现在最省心的方案是直接在本机配置 `WEREAD_API_KEY`，不再依赖 Chrome 扩展、Cookie 抓取或桥接 token。

项目已经支持：

- 后台直接读取本机环境中的 `WEREAD_API_KEY`
- 后台按固定间隔自动同步书架和笔记
- 如果配置了 `API_TOKEN`，同步后会顺手推送到你的云端 `yangminggu.com/tasks`

推荐把 Key 放在项目根目录 `.env`：

```env
WEREAD_API_KEY=wrk-你的key
```

启动后：

1. 打开本地页面 `http://127.0.0.1:8080/dashboard.html`
2. 直接点“同步微信读书”
3. 之后就交给本地后台服务自动同步

这个模式下，微信读书板块只走 API-first 的本地同步链路。

### 运行约定

- 本地服务启动时会从项目根目录 `.env` 读取 `WEREAD_API_KEY`
- 手动同步入口：`POST /api/weread/sync`
- 状态查看入口：`GET /api/weread/status`
- 自动同步也复用同一套 API-first 实现，不再区分“本地手动同步”和“扩展同步”

### 推荐环境变量

```env
WEREAD_API_KEY=wrk-你的key
WEREAD_SYNC_MODE=api-key
WEREAD_AUTO_SYNC_SOURCE=api-key
WEREAD_AUTO_SYNC_INTERVAL_HOURS=2
WEREAD_AUTO_SYNC_START_DELAY_SECONDS=15
WEREAD_AUTO_SYNC_ON_START=1
```

### 排查建议

- 如果 `GET /api/weread/status` 返回 `hasApiKey=false`，先检查 `.env` 是否存在 `WEREAD_API_KEY`
- 如果同步时报 “API Key 无效或已失效”，先确认 key 是否仍可用，再重启本地服务
- 如果同步时报 “当前微信读书 skill 需要升级”，按 skill 包里的升级提示先更新 skill 版本
- 如果网关偶发超时，当前实现会自动重试 3 次；仍失败时再看终端日志里的 `[weread-api]` 和 `[weread-sync]` 前缀日志

## 数据文件说明

项目里把“应用自己的数据”和“微信读书同步数据”拆开了：

- `data.json`
  主应用数据，比如任务、项目、笔记与文档等
- `.weread_data.json`
  微信读书书架、最近动态、同步时间等
- `.weread_notes.json`
  微信读书笔记明细，包括划线和评论
- `.backups/`
  本地数据备份

其中带前缀 `.` 的微信读书本地文件和备份目录已经加入 `.gitignore`，不会被推到 GitHub。

## 仓库结构

```text
.
├── dashboard.html
├── server.py
├── weread/
│   ├── __init__.py
│   └── service.py
├── requirements.txt
└── .github/
    └── workflows/
```

## GitHub 上现在建议怎么用

这个仓库现在最适合做两件事：

- 用 GitHub 保存代码版本和功能演进
- 用 GitHub Actions 做基础检查，避免改坏服务端或扩展脚本

## Cloudflare Worker 版本

仓库里已经有一套给 `yangminggu.com/tasks` 用的 Worker 代码：

- Worker 入口：`src/index.js`
- Worker 配置：`wrangler.jsonc`
- 线上页面静态资源：`public/tasks/index.html`

本地改完 [dashboard.html](/Users/liubike/Desktop/任务管理App/dashboard.html) 后，可以用下面这条命令把云端用的页面副本同步好：

```bash
npm run sync:dashboard
```

现在这套 Worker 会：

- 直接服务 `https://yangminggu.com/tasks`
- 用 KV 保存 `tasks / books / notes / updates`
- 把前端请求自动走到 `/tasks/api/*`
- 在云端页面里提示“微信读书同步先走本地版”

## 把本地数据推到云端

已经准备好一个一次性上传脚本：

- `scripts/push_cloud_data.py`

用法：

```bash
python3 scripts/push_cloud_data.py https://yangminggu.com/tasks
```

它会读取你本地当前的合并数据，然后 POST 到云端 Worker 的 `/api/data`，把任务、书架、笔记和动态一起推上去。

等你后面决定要正式上线，再接下面其中一种部署路线会更顺：

- 传统云服务器或轻量应用服务器，直接跑 `python3 server.py`
- 把前端和后端拆开，前端挂站点，后端部署成单独服务
- 用 GitHub Actions 配合部署脚本，把更新自动发到你的服务器

## 下一步比较推荐

如果目标是挂到 `yangminggu.com`，建议顺序是：

1. 先把这个仓库当成唯一代码源
2. 先在本地把功能跑稳
3. 再决定线上是保留一体化 Flask，还是拆成前端站点 + API
4. 最后再接你的小程序或自动化同步链路
