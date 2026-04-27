# 数据同步架构说明

## 三端概览

| 端 | 入口 | 数据存储 |
|---|---|---|
| 小程序 | 直接调用 Cloudflare Worker | 云端 KV（`app_data` / `diary_data`） |
| 网页版·云端模式 | `yangminggu.com/tasks`（Worker） | 云端 KV |
| 网页版·本地模式 | `localhost:8080`（server.py） | 本地 `data.json` / `diary.json` |

---

## 数据流详解

### 任务（Tasks）

```
小程序
  └─ POST /api/tasks/add|update|delete → 云端 KV ←┐
                                                    │ 每15分钟拉取合并
网页云端版                                           │
  └─ POST /api/data → 云端 KV ←──────────────────── │
                                                    │
网页本地版                                           │
  └─ POST /api/data → 本地 data.json ───────────────┘
        ↑ 保存到本地，不自动推云端（⚠️ 见问题1）
```

### 日记（Diary）

```
小程序
  └─ POST /api/diary → 云端 KV ←┐
                                 │ 每15分钟拉取
网页云端版                        │
  └─ POST /api/diary → 云端 KV ← │
                                 │
网页本地版                        │
  └─ POST /api/diary → 本地 diary.json
        ↑ 不自动推云端（⚠️ 见问题2）
```

### 本地 server.py 主动推云端的时机

| 触发条件 | 推送内容 |
|---|---|
| 微信读书同步完成 | 任务+书单（`/api/data`） |
| 凌晨5点每日重置 | 任务+书单 + 日记 |
| 手动调用 `/api/diary/push` | 日记 |
| 手动调用 `/api/sync/pull` | 从云端拉取（反向） |

---

## 每日重置

两处独立运行，互不干扰：

- **云端**：Cron `0 21 * * *` UTC = 北京时间每天凌晨5点
- **本地**：`server.py` 内线程，每天5点（本地时区）

两处都执行相同操作：
1. 把今日日记归档（如果日期变了）
2. 清除已完成任务

---

## 已知逻辑问题

### ⚠️ 问题1：本地网页版任务改动不同步到云端

**现象**：在本地网页版新增/修改任务 → 保存到 `data.json` → 15分钟后本地从云端拉取 → 云端没有这条任务 → 被我们的合并逻辑删除（"云端为准"）。

**根因**：`server.py` 的 `POST /api/data` 只写本地，不调用 `_push_to_cloud_async`。

**影响范围**：只要不在本地网页版新增任务就不会触发。小程序和云端网页版新增任务不受影响。

**修复方式**：在 `server.py` 的 `save_data()` 末尾加一行 `_push_to_cloud_async("local-save")`。

---

### ⚠️ 问题2：本地网页版日记不同步到云端

**现象**：在本地网页版写日记 → 保存到 `diary.json` → 小程序打开时从云端读取，看不到本地写的内容。

**根因**：`server.py` 的 `POST /api/diary` 只写本地，不调用 `_push_diary_to_cloud_async`。

**修复方式**：在 `server.py` 的 `save_diary()` 末尾加一行 `_push_diary_to_cloud_async("local-save")`。

---

### ⚠️ 问题3：日记归档时间依赖本地时区

本地每日重置以"凌晨5点本地时间"为界，云端 Cron 以 UTC 21:00（北京时间5点）为界。两者一致，**但**本地 server.py 里 `effective_diary_date()` 用的是 `datetime.now()`（无时区），如果 Mac 时区不是 CST 会导致归档日期错误。

---

## 需要修复的两处代码

```python
# server.py — save_data() 末尾加：
_push_to_cloud_async("local-save")

# server.py — save_diary() 末尾加：
_push_diary_to_cloud_async("local-save")
```