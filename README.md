# 任务管理 App

个人效率面板，包含三个核心模块：

- **任务**：添加、编辑、完成任务，每日自动重置已完成项
- **日记**：每日写作，自动归档历史，支持随机回顾往期内容
- **微信读书**：同步书架、阅读进度、划线笔记，展示每日/每周阅读时长统计

同时提供微信小程序和网页版（`https://yangminggu.com/tasks`），数据存储在 Cloudflare Workers KV，云端完全独立运行，不依赖本地服务器。技术栈：Taro + Vue.js 前端，Cloudflare Workers 后端，Python + GitHub Actions 做微信读书定时同步。


## 数据流

```
                    ┌─────────────────────────────────────────────┐
                    │            Cloudflare Worker KV（云端）       │
                    │                                             │
  yangminggu.com/tasks ──读写──►                                  │
  微信小程序 ────────────读写──►  Worker API                        │
                    │                    ▲                        │
                    │                   写入                       │
                    └────────────────────┼────────────────────────┘
                                        │
                    Cloudflare Cron（13 0-15,23 * * *，北京时间 7:13-23:13）
                          │ dispatchWereadSync()
                          ▼
                    GitHub Actions（repository_dispatch: weread-sync）
                          │ sync/sync_weread.py
                          ▼
                    微信读书 API Gateway
                          │ 书架、进度、笔记、热力图

本地 Flask（每 15 分钟 pull）◄──── Worker KV
      │ localhost:8080
      ▼
data/ 本地文件（开发/备份用）
```

**调度职责划分：**

| 触发器 | cron | 做什么 |
|---|---|---|
| Cloudflare Cron | `0 * * * *` | 每日重置（归档日记、清除已完成任务） |
| Cloudflare Cron | `13 0-15,23 * * *` | 触发 GitHub Actions 跑微信读书同步 |
| GitHub Actions | `repository_dispatch` | 运行 `sync/sync_weread.py` 写入 KV |

Cloudflare 负责定时调度，GitHub Actions 只负责跑 Python 同步脚本，职责不交叉。微信读书同步不再依赖 GitHub 自带的 schedule（GitHub schedule 存在数小时延迟导致漏跑）。

**写入规则：**

| 操作 | 入口 | 写哪里 |
|---|---|---|
| 改任务/日记 | 云端网页 `yangminggu.com/tasks` | ✅ Worker KV（云端） |
| 改任务/日记 | 微信小程序 | ✅ Worker KV（云端） |
| 改任务/日记 | 本地网页 `localhost:8080` | ⚠️ 仅本地 `data/`，不推云端 |
| WeRead 同步 | Cloudflare Cron 自动触发 | ✅ Worker KV（云端） |
| 每日重置 | Cloudflare Cron 自动触发 | ✅ Worker KV（云端） |
| 云端 pull | 本地 Flask 每 15 分钟自动 | 本地 `data/` 跟随云端更新 |

**云端完全独立运行的部分（不依赖本地机器）：**
- `yangminggu.com/tasks` 服务网页 dashboard，API 直接打 Worker
- 微信小程序直接调 Worker API 读写 KV
- Worker Cron `0 * * * *`：每日重置已完成任务、归档日记
- Worker Cron `13 0-15,23 * * *`：dispatch GitHub Actions 触发微信读书同步

## 模块结构

```
.github/       GitHub Actions workflow（微信读书同步，由 Cloudflare Cron 触发）         ← 云端 CI
sync/          同步脚本（微信读书 API 同步、云端推送等 Python 脚本）                      ← GitHub Actions 调用
data/          运行时数据文件（gitignore，不提交）                                       ← 本地文件，仅本地 Flask 使用
web/           本地 Flask 服务器 + dashboard.html 源码（localhost:8080，开发用）         ← 本地
worker/        Cloudflare Worker（云端 API + 定时任务，yangminggu.com/tasks）            ← 云端
miniprogram/   微信小程序（Taro）                                                       ← 云端（调 Worker API）
```

## 快速开始

### 本地运行

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

### 云端部署（Cloudflare Worker）

```bash
cd worker
npm install
npm run deploy
```

Cloudflare Worker Secrets（`wrangler secret put <NAME>`）：

| Secret | 用途 |
|---|---|
| `API_TOKEN` | 鉴权小程序/脚本对 Worker API 的请求 |
| `GITHUB_DISPATCH_TOKEN` | Worker Cron 触发 GitHub repository_dispatch 用的 fine-grained PAT（仓库 `yangminggulab/dx-weread`，Contents: Read and write） |

GitHub Actions Secrets（仓库 Settings → Secrets）：

| Secret | 用途 |
|---|---|
| `WEREAD_API_KEY` | 微信读书 API Gateway 认证 key |
| `API_TOKEN` | 写回 Cloudflare Worker KV 的鉴权 token |
| `CLOUD_BASE_URL` | Cloudflare Worker API 地址 |

## 数据文件（本地，仅本地 Flask 使用）

以下文件只存在于本地机器，云端数据存在 Cloudflare Worker KV 中，两者通过 pull 同步。

| 文件 | 内容 |
|---|---|
| `data/tasks.json` | 任务数据 |
| `data/diary.json` | 日记 |
| `data/time.json` | 时间模块数据，目前包含 `weread` 阅读时长 |
| `data/weread_data.json` | 微信读书书架、统计 |
| `data/weread_notes.json` | 微信读书笔记 |
| `local_backups/` | 每次写入前的本地自动备份 |

`data/` 整个目录已加入 `.gitignore`，不提交到 git。

## 快速定位：我要改…

| 需求 | 改哪里 | 影响范围 |
|---|---|---|
| 修改小程序的任务/日记 UI | `miniprogram/src/pages/index/index.jsx` + `index.scss` | ☁️ 云端 |
| 修改小程序的读书书架 UI | `miniprogram/src/pages/books/index.jsx` + `index.scss` | ☁️ 云端 |
| 修改小程序的读书笔记 UI | `miniprogram/src/pages/notes/index.jsx` + `index.scss` | ☁️ 云端 |
| 添加/修改小程序 API 调用 | `miniprogram/src/api/index.js` | ☁️ 云端 |
| 修改网页端 UI (dashboard) | `web/dashboard.html` | 🏠 本地 + ☁️ 云端（同一文件，Worker 也托管） |
| 添加/修改云端 Worker API 接口 | `worker/src/index.js` | ☁️ 云端 |
| 添加/修改本地 Flask API 接口 | `web/routes/api.py` | 🏠 本地 |
| 修改云端任务/日记存储逻辑 | `worker/src/index.js`（`loadData` / `saveData` / `loadDiary`） | ☁️ 云端 |
| 修改本地任务数据存储逻辑 | `web/services/storage.py` | 🏠 本地 |
| 修改本地日记存储逻辑 | `web/services/diary_store.py` | 🏠 本地 |
| 修改微信读书同步逻辑 | `sync/sync_weread.py` + `.github/workflows/weread_sync.yml` | ☁️ 云端（GitHub Actions） |
| 修改微信读书 API 调用底层 | `sync/weread/service.py` | ☁️ 云端（GitHub Actions） |
| 修改微信读书统计计算（本地） | `web/services/weread_stats.py` | 🏠 本地 |
| 修改云端 pull 到本地的逻辑 | `web/services/cloud_sync.py` | 🏠 本地 |
| 修改本地自动备份逻辑 | `web/services/json_store.py` | 🏠 本地 |
| 修改 Cloudflare Worker 定时任务 | `worker/src/index.js`（`scheduled`） + `wrangler.jsonc`（`crons`） | ☁️ 云端 |
| 修改本地 Flask 定时任务 | `web/server.py` | 🏠 本地 |
| 修改小程序全局配置/tabBar | `miniprogram/src/app.config.js` | ☁️ 云端 |
| 修改小程序全局样式 | `miniprogram/src/app.scss` | ☁️ 云端 |

## 逐文件职责清单（供 AI / 开发者快速定位）

### `web/` — 本地 Flask 服务器（⚠️ 仅本地运行，主要价值是本地备份）

> 云端功能（网页 UI、API、每日重置、WeRead 同步）已全部由 Cloudflare Worker + GitHub Actions 承担。
> 本地 Flask 目前保留的主要价值：每 15 分钟 pull 云端数据到本地 `data/`，由 `json_store.py` 自动备份到 `local_backups/`。

| 文件 | 职责 | 本地/云端 |
|---|---|---|
| `web/server.py` | Flask 入口，注册路由和定时任务，启动服务器 | 🏠 本地 |
| `web/dashboard.html` | 浏览器端 UI（任务/日记/读书面板）；同时被 Cloudflare Worker 托管在 `yangminggu.com/tasks` | 🏠 本地 + ☁️ 云端 |
| `web/routes/api.py` | 所有 REST API 路由（任务 CRUD、日记读写、微信读书数据查询、云端 pull） | 🏠 本地 |
| `web/services/storage.py` | 任务数据聚合层（load/save/merge/migrate），合并 base data、weread、notes、time | 🏠 本地 |
| `web/services/json_store.py` | 通用 JSON 文件读写；**每次写入前自动备份到 `local_backups/`**（本地副本唯一来源） | 🏠 本地 |
| `web/services/diary_store.py` | 日记数据的持久化层 | 🏠 本地 |
| `web/services/time_store.py` | 时间模块数据（阅读时长等）持久化层 | 🏠 本地 |
| `web/services/weread_store.py` | 微信读书书架/统计数据持久化层 | 🏠 本地 |
| `web/services/weread_sync.py` | 微信读书 API 同步逻辑（旧，现已由 GitHub Actions + `sync/sync_weread.py` 替代） | 🏠 本地（已停用） |
| `web/services/weread_stats.py` | 微信读书统计计算（阅读趋势、周报等） | 🏠 本地 |
| `web/services/cloud_sync.py` | 从云端 Worker KV **pull** 数据到本地（无 push，本地改动不推云端） | 🏠 本地 |
| `web/services/config.py` | 环境变量读取和配置 | 🏠 本地 |

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

### `.github/` — GitHub Actions

| 文件 | 职责 |
|---|---|
| `workflows/weread_sync.yml` | 微信读书同步（由 Cloudflare Cron 通过 `repository_dispatch` 触发，也支持手动 `workflow_dispatch`），调用 `sync/sync_weread.py` |

### `worker/` — Cloudflare Worker

| 文件 | 职责 |
|---|---|
| `src/index.js` | Worker 全部逻辑：KV 读写 API、Cron 每日重置任务（`0 * * * *`）、Cron 触发微信读书同步（`13 0-15,23 * * *` → GitHub repository_dispatch） |

### `sync/` — 命令行同步脚本

| 文件 | 职责 |
|---|---|
| `sync/sync_weread.py` | 微信读书全量同步并推送云端（GitHub Actions 调用，也可手动运行） |
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

## 各文件函数清单

### web/server.py
- `_Handler` — HTTP 请求处理器类
- `_Handler._cors_headers()` — 构建 CORS 响应头
- `_Handler._send_json(data, status)` — 发送 JSON 响应
- `_Handler._read_json_body()` — 解析请求 JSON body
- `_Handler.do_OPTIONS()` — CORS 预检请求
- `_Handler._dispatch(method)` — 路由 GET/POST 到 API handler 或返回静态 HTML
- `_Handler.do_GET()` / `_Handler.do_POST()` — 代理到 `_dispatch`

### web/routes/api.py
- `handle_request(method, path, body)` — API 路由总入口，分发到数据/日记/weread/cloud 子路由

### web/services/storage.py
- `load_base_app_data()` — 加载基础 app 数据 JSON
- `write_base_app_data(data)` — 写入基础 app 数据
- `estimate_total_pages(total_words)` — 字数估算页数 (500字/页)
- `estimate_current_page(progress_percent, total_pages)` — 按进度估算当前页
- `split_combined_payload(data)` — 拆解合并 payload 为 user/weread/notes 三部分
- `merge_app_and_special_data(data, weread, weread_notes_data, time_data)` — 聚合所有数据为统一响应
- `migrate_embedded_special_data()` — 迁移嵌入在 data.json 中的 weread/time 数据到独立文件
- `load_app_data()` — 加载并合并所有数据（base+weread+notes+time）

### web/services/json_store.py
- `load_json_file(path, default)` — 加载 JSON 文件，缺失时返回默认值
- `write_json_file(path, data, mode)` — 写入 JSON 文件
- `backup_file(path, prefix, keep=20)` — 创建带时间戳的备份，保留最近 N 份

### web/services/diary_store.py
- `empty_diary()` — 空日记结构
- `load_diary_file()` — 加载并标准化日记 JSON
- `write_diary_file(diary)` — 备份并写入日记
- `effective_diary_date()` — 返回今天日期（凌晨5点前回退到昨天）
- `archive_diary_if_needed(diary)` — 日期变更时自动归档今天的日记
- `merge_diary_update(stored_diary, incoming_diary)` — 合并日记更新（解决 today/archive 冲突）
- `merge_diary(local_diary, cloud_diary)` — 合并本地与云端日记
- `_clean_diary_content(text)` — 清理日记内容（移除旧版视频标签、时间戳、分隔线）
- `_normalize_diary(diary)` — 标准化日记结构
- `_normalize_diary_archive_entry(entry)` — 标准化单条归档
- `_merge_diary_archive_entry(left, right)` — 合并两条归档（取更长内容、更高浏览数）
- `_timestamp_order(incoming, stored)` — 时间戳比较决定合并优先级

### web/services/time_store.py
- `empty_time_data()` — 空时间数据
- `normalize_time_data(data)` — 标准化时间数据（确保 weread 子结构）
- `load_time_data()` — 加载并标准化时间数据
- `write_time_data(data)` — 标准化并写入时间数据

### web/services/weread_store.py
- `normalize_weread_book(book)` — 标准化单本书籍
- `normalize_weread_note(note)` — 标准化单条笔记
- `normalize_weread_update(item)` — 标准化单条更新
- `normalize_weread_data(data)` — 标准化全部 weread 数据
- `normalize_weread_notes_data(data)` — 标准化全部笔记数据
- `load_weread_data()` / `write_weread_data(data)` — 读写 weread 数据
- `load_weread_notes_data()` / `write_weread_notes_data(data)` — 读写笔记数据
- `is_weread_book(book)` / `is_weread_note(note)` / `is_weread_update(item)` — 判断数据来源
- `pick_book_accent(seed)` — 确定性选书籍主题色
- `extract_note_preview(summary)` — 提取笔记预览首行
- `allocate_id(used_ids, preferred)` — 分配不重复 ID
- `merge_weread_store(existing, incoming)` — 合并 weread 数据（去重 books/notes/updates）
- `merge_weread_notes_store(existing, incoming)` — 合并笔记数据（按 sourceItemId 去重）
- `coerce_int_id(value)` / `has_tag(tags, name)` — 工具函数

### web/services/weread_sync.py
- `fetch_weread_data(existing_notes_store)` — 通过 gateway API 拉取完整 weread 快照
- `build_weread_sync_payload(result)` — 构建标准化同步 payload
- `persist_weread_sync_payload(payload)` — 持久化同步数据到 store
- `run_weread_sync(label)` — 完整同步流程（fetch → persist）
- `save_combined_data(data)` — 保存外部合并数据
- `weread_status_payload()` — 构建前端状态信息（API key、书籍数等）
- `start_background_jobs()` — 启动后台定时同步线程

### web/services/weread_stats.py
- `empty_weread_stats()` — 空统计结构
- `normalize_weread_stats(stats)` — 标准化阅读统计
- `has_weread_stats(stats)` — 判断是否有有效数据
- `merge_weread_stats(primary, fallback)` — 合并统计（优先 primary）
- `derive_weread_time_fields(stats)` — 从统计推算周阅读/总阅读天数
- `build_weread_time_data(stats, synced_at)` — 构建时间域 weread 记录
- `merge_time_data(existing, weread_stats, weread_synced_at)` — 合并 weread 时间数据

### web/services/cloud_sync.py
- `merge_cloud_into_local(local, cloud, preserve_local_only_tasks)` — 云端数据合并到本地（时间戳冲突解决）
- `pull_from_cloud(label)` — 从云端 API 拉取并合并 app 数据和日记
- `do_daily_reset(today, label)` — 凌晨重置（cloud pull → 日记归档 → 清除已完成任务）
- `start_background_jobs()` — 启动 cloud-pull 和 5am-reset 后台线程

### web/services/config.py
- `load_env_file()` — 加载 `.env` 文件到环境变量
- `env_flag(name, default)` — 读取布尔环境变量
- `env_float(name, default)` — 读取浮点环境变量

### web/dashboard.html
- 单个 HTML 文件，包含内联 Vue.js 应用，渲染任务/日记/读书三面板 UI

### miniprogram/src/app.js
- 小程序入口，初始化 Taro

### miniprogram/src/app.config.js
- 页面路由配置、tabBar 定义（任务/书架/笔记三个 tab）

### miniprogram/src/app.scss
- 小程序全局样式

### miniprogram/src/config.js
- 前端配置常量（API base URL 等）

### miniprogram/src/api/index.js
- `request(path, method, data)` — 封装 Taro.request，自动附加 auth header
- `getData()` → GET /api/data
- `saveData(data)` → POST /api/data
- `addTask(task)` → POST /api/tasks/add
- `updateTask(task)` → POST /api/tasks/update
- `deleteTask(id)` → POST /api/tasks/delete
- `getDiary()` → GET /api/diary
- `getDiaryToday()` → GET /api/diary?today=1
- `saveDiary(diary)` → POST /api/diary
- `addNote(note)` → POST /api/notes/add
- `deleteNote(id)` → POST /api/notes/delete
- `updateNote(note)` → POST /api/notes/update

### miniprogram/src/pages/index/index.jsx（任务+日记主页面）
- `TaskPage()` — 主组件，管理任务 CRUD、日记编辑、左右滑切换 tab
- `loadData()` — 拉取全量数据
- `loadDiaryToday()` — 轻量拉取今日日记
- `loadDiary()` — 拉取完整日记（含归档，进入日记 tab 时懒加载，`archiveLoadedRef` 防重复）
- `handleStatusChange(task)` — 切换任务完成状态（乐观更新）
- `handleDelete(id)` — 确认并删除任务
- `handleAdd()` — 提交新任务
- `openEdit(task)` / `handleEditSave()` — 编辑任务；**点击弹窗外自动保存**，无保存/删除按钮；任务名称用 Textarea（从左上角起排）
- `handleDiaryChange(content)` — 日记输入防抖自动保存
- `openFullscreen(idx)` — 打开日记归档全屏阅读器
- `recordArchiveView(sourceDiary, idx)` — 标记一条归档已读（stamp viewCount/lastViewedAt），**同时写本地 view meta**，不依赖服务端保存
- `cleanDiaryContent(text)` — 日记内容清理
- `normalizeDiaryPayload(payload)` — 标准化日记数据结构
- `mergeDiaryArchiveViewMeta(baseArchive, overlayArchive)` — 合并归档浏览元数据
- `pickPreferredArchiveIdx(archive)` — 从最近 30 天未读条目随机选往期日记；调用前先用本地 view meta 补充 `lastViewedAt`（防服务端丢失导致候选池失效）；不再强制"历史上的今天"优先
- `readViewMeta()` / `persistViewMeta(archive)` — 读写 `diary_view_meta_v1`（`{ date → lastViewedAt }`），内存镜像 `_viewMetaCache` 避免高频 `getStorageSync`

### miniprogram/src/pages/books/index.jsx（读书书架页面）
- `BooksPage()` — 主组件，展示在读书架/想读/读完三栏
- `loadData()` — 拉取 weread 书籍数据
- `ReadingRing({ weekDaily, totalReadDays, dayGoalMinutes })` — Canvas 阅读进度环
- `drawRing2d(ctx, W, H, minutes, goal)` — 绘制 2D 环形进度图
- `getTodayMinutes(weekDaily)` — 计算今日阅读分钟数

### miniprogram/src/pages/notes/index.jsx（读书笔记页面）
- `NotesPage()` — 主组件，笔记 CRUD、日记条目展示、搜索
- `loadData()` — 拉取笔记和日记数据
- `handleAdd()` — 新建笔记
- `pickRandomNotes(notes, count)` — 随机选取 N 条笔记

### worker/src/index.js（Cloudflare Worker）
- `fetch(request, env)` — Worker 主入口，路由 API 请求和 CRUD
- `scheduled(event, env, ctx)` — Cron 分发：分钟为 13 的 cron 触发 `dispatchWereadSync()`，其余触发 `runDailyReset()`
- `dispatchWereadSync(env, event)` — POST GitHub repository_dispatch 触发微信读书同步
- `loadData(kv)` / `saveData(kv, data)` — KV 读写 app 数据
- `loadDiary(kv)` / `saveDiary(kv, diary)` — KV 读写日记
- `loadCurrentDiary(kv)` — 加载日记并自动归档
- `mergeDataForFullSave(existing, incoming)` — 合并增量数据；incoming 不含 `books` 时从 KV 保留现有值（防批量 POST 清空书架）
- `mergeDiaryUpdate(storedDiary, incomingDiary)` — 合并日记更新
- `runDailyReset(env)` — 每日重置（归档日记、清除已完成任务）

**学习书架原子接口**（`POST /api/books/add|update|delete`）：进度修改直接写单本书，不走整包覆盖，防止旧标签页竞态回滚。

### sync/weread/env.py
- `load_dotenv(repo_root)` — 加载 `.env` 文件

### sync/weread/service.py（微信读书 API 核心）
- `WeReadGatewayClient` — HTTP 客户端（带重试）
- `WeReadGatewayClient.call(api_name, **params)` — 调用 gateway API（最多重试3次）
- `sync_weread_snapshot(existing_notes_store)` — 完整快照同步（书架/进度/笔记/统计/热力图）
- `_page_notebooks(client)` — 分页拉取笔记本
- `_page_reviews(client, book_id)` — 分页拉取书评
- `_fetch_book_progress(client, book)` — 拉取单本书进度
- `_fetch_book_notes(client, notebook_book, existing_notes_by_book)` — 拉取单本书笔记
- `_normalize_book(item, progress_payload)` — 标准化书籍
- `_normalize_bookmark_note(book_title, book_id, mark, chapter_titles)` — 标准化划线
- `_normalize_review_note(book_title, book_id, review_item)` — 标准化书评
- `_fetch_recent_daily_read_times(client, current_monthly, month_count)` — 拉取多月阅读时长

### .github/workflows/weread_sync.yml
- 由 Cloudflare Worker Cron（`13 0-15,23 * * *`）通过 `repository_dispatch: weread-sync` 触发（北京时间 7:13-23:13）
- 也支持 `workflow_dispatch` 手动触发
- 所需 GitHub Secrets：`WEREAD_API_KEY`、`API_TOKEN`、`CLOUD_BASE_URL`

### sync/sync_weread.py
- `sync()` — 全量同步 weread（书架、进度、笔记、热力图）并推送云端 KV

### sync/backup_bookshelf.py
- `run_backup()` — 备份书架数据

### sync/export_notes.py
- `run_export()` — 导出全部笔记为 Markdown 文件
- `export_book(notebook_book)` — 导出单本书笔记
- `format_markdown(notebook_book, bookmark_payload, reviews)` — 格式化为 Markdown
- `generate_index(exported)` — 生成 `微信读书笔记模块-README.md` 索引

---

## 开发经验备忘

### 微信小程序 Textarea 在弹窗（modal/popup）里的正确写法

原生 `Input` 不管 CSS 高度设多大，文字都垂直居中（单行组件）。弹窗里需要多行输入时必须用 `Textarea`。

**Textarea 在 modal 里必须加以下 props，否则键盘弹起时会抖动/跳动：**

```jsx
<Textarea
  value={...}
  onInput={e => ...}
  adjustPosition={false}    // ⭐ 最关键：禁止键盘弹起时微信自动上推页面，modal 里不设会整体跳位
  showConfirmBar={false}     // 去掉键盘顶部"完成"栏，减少一次布局变化
  disableDefaultPadding      // 去掉原生内边距，防止内容区跳动
  cursorSpacing={24}         // 键盘与光标间保留固定间距，防止遮挡触发滚动补偿
  maxlength={200}
/>
```

**受控模式的平台限制：** 微信官方文档明确说明，`textarea` 的 `onInput` 返回值不会反映到组件上，即 textarea 不支持真正的受控模式。每次 `onInput` 后用新 `value` 强制覆盖会造成光标跳动。如需在 modal 里稳定使用，遵循上述 props 配置即可，不要额外绑定 `cursor` prop（`cursor={value.length}` 每次 re-render 都强制移光标，必然抖动）。

**参考：** 日记页 `diary-textarea` 是经过验证的稳定写法，新增弹窗输入框时以它为模板。
