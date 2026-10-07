# 数据同步架构说明

> 按当前源码核对：2026-10-05。云端是权威数据源；本地保存默认不自动推云端。TaskState（SQLite Durable Object）统一读写与冲突检查已于本日部署，迁移核对通过。迁移、配套发布与回滚边界见 [Apple 同步排查](../../Apple客户端/Docs/SYNC.md)。

项目整体关系见 [总架构](../../docs/architecture.md)。本文描述任务、日记、阅读与长篇思想同步；`财务管理/` 使用独立本地 SQLite，引擎和账本迁移规则见 [财务说明](../../财务管理/财务模块-README.md)，不参加下面的主系统同步、根目录 JSON 合并或 App Group 缓存。

## 客户端与存储

| 端 | 入口 | 数据存储 |
|---|---|---|
| 微信小程序 | 直接调用个人版 Worker API | Worker 统一存储 |
| 云端网页 | `https://yangminggu.com/tasks` | Worker 统一存储 |
| macOS/iOS 任务工作台与小组件 | `Apple客户端/Shared/Networking/WorkerAPIClient.swift` | TaskState；App Group 保存配置、草稿、缓存和待传播回执；不含 Mac 财务 |
| Coze 助手 | 独立鉴权 adapter-worker 调用主 API | 主 Worker 统一存储，不另建数据源 |
| 本地 Python 服务 | `web/server.py`，默认 `127.0.0.1:8080` | 本地 `data/` 文件 |

逻辑文档仍为 `app_data`（任务、书籍、笔记、动态、阅读统计）、`diary_data`（日记）、`essays_data`（长篇思想）；`daily_reset_date` 记录重置日期。首次将旧 KV 导入 TaskState 并保留原始副本，之后 API 与每日重置都访问同一对象的事务存储；旧 KV 不再自动镜像。`sync_version` 供客户端轻量检测变化。

GitHub 默认分支的配套脚本通过独立提交 `d1ea56c` 发布，目前工作流仍使用默认分支的 `sync/sync_weread.py`；本工作分支的目录整理后入口为 `web/sync/sync_weread.py`。两者使用相同的阅读专用写入接口，后续合并目录整理时更新工作流路径。

## 本地不自动推送的边界

本地服务使用 Python 标准库 `ThreadingHTTPServer`，不是 Flask。启动时会同时开启：

- 每 15 分钟云端 pull，实际落盘任务和日记。
- 本地微信读书同步，默认每 2 小时，配置了 API Key 才能获取数据。
- 本地 05:00 重置及开机补跑，归档本地日记、清除本地已完成任务。

本地 `POST /api/data` 和 `POST /api/diary`、本地阅读同步、每日重置均只写本地文件。后台没有把这些改动推云端的步骤，也没有 `/api/diary/push` 路由。本地可写，因此不能把它描述成完全只读或完整云端镜像。

这个原则来自一个教训：曾经让本地每次保存都推云端，结果本地
`data.json` 还没来得及拉到最新状态（任务刚在小程序标为完成），
本地网页版触发保存 → 把旧的"未完成"数据推上去 → 覆盖了云端的
"已完成" → 小程序再打开任务又变回未完成。

当前数据路径是 `data/tasks.json`；上面提到的根目录 `data.json` 是历史路径。这个教训仍适用：不要恢复本地旧快照自动推云端的行为。

## 当前数据流与显式例外

| 操作 | 当前流程 | 写入范围 |
|---|---|---|
| 小程序任务修改 | `POST /api/tasks/add|update|delete` | 云端 `app_data` |
| 云端网页任务/动态保存 | `POST /api/data` 携带 `_base` 保存基线 | 按 ID/字段合并；同字段冲突返回 409 |
| 学习书籍局部修改 | `POST /api/books/add|update|delete` | 云端 `app_data` |
| Apple App 写入 | 各资源局部 API；日记只提交今日内容 | 对应云端数据；客户端写入排队 |
| 新网页按日期日记保存 | `POST /api/diary/entry`，携带原正文与确认时间 | 单日 CAS，409 保留草稿；包括历史与显式清空 |
| 旧客户端日记保存 | `POST /api/diary` | 云端 `diary_data`，由 Worker 合并 |
| 本地保存 | 本地 `POST /api/data`、`/api/diary` 或 `/api/diary/entry` | 本地 `data/`，不自动推送 |
| 本地云端 pull | 请求 `/api/data` 与 `/api/diary` | `data/tasks.json` 中的任务与 `data/diary.json` |
| 云端阅读同步 | `web/sync/sync_weread.py` 拉微信读书数据后 `POST /api/weread` | 仅更新阅读来源记录和统计，不触碰任务与手动内容 |
| 本地阅读同步 | `web/services/weread_sync.py` 调用 `web/sync/weread/service.py` | 本地阅读书架、笔记和时间文件 |
| 手动日记推送 | `bash web/sync/sync_diary.sh` 拉取、合并后 POST | 本地日记与云端 `diary_data`；会写云端 |
| 手动长篇思想推送 | `python3 web/sync/push_essays.py` 按已有标题跳过 | 云端 `essays_data`；不是后台 pull |

手动推送脚本是显式例外，不能据此推导本地后台会自动上传任务或日记。`data/essays.json` 是本地推送源，后台不会自动从云端下载长篇思想。

## 调度

| 位置 | 触发 | 操作 |
|---|---|---|
| Cloudflare Cron | `0 * * * *`（UTC，每小时） | 按上海时间 05:00 日期边界检查，以 `daily_reset_date` 每个日记日执行一次归档与清除已完成任务 |
| Cloudflare Cron | `13 0-15,23 * * *`（UTC） | 北京时间 07:13–23:13 每小时触发 GitHub `repository_dispatch: weread-sync` |
| GitHub Actions | `repository_dispatch` 或手动 `workflow_dispatch` | 运行 `web/sync/sync_weread.py`；workflow 没有 schedule |
| 本地云端 pull | 启动后约 10 秒，之后每 15 分钟 | 合并任务与日记到本地 |
| 本地阅读同步 | 启动延迟与间隔可配置，默认每 2 小时 | 调用微信读书 Gateway，保存本地 |
| 本地每日重置 | 本机时间 05:00，或 05:00 后启动时补跑 | 先 pull，再归档本地日记、清除本地完成任务、记录本地重置日期；不推云端 |

云端 Cron 统一配置在 `worker/wrangler.jsonc`。从 `worker/` 部署，或在根目录执行 `npm run deploy`；不能沿用早期 `0 21 * * *` 的说明。

## 合并规则

### 后台 pull 的任务

`web/services/cloud_sync.py:merge_cloud_into_local()`：

- 云端有、本地也有：比较 `updatedAt`，缺失时用 `createdAt`；本地时间字符串较新时保留本地，否则接受云端。
- 云端有、本地没有：加入本地。
- 云端没有、本地有：后台 pull 默认删除本地项，防止已被云端清除的任务复活。
- 合并函数还支持书籍、笔记和动态，但当前 `pull_from_cloud()` 只将合并后的任务写回基础应用文件，其他列表不会由它落盘。

这是本地合并规则，不代替云端冲突控制。局部任务接口补充服务端 `updatedAt`；云端跨请求一致性由 TaskState 的队列和事务保证，网页另有保存基线检查。

### 本地 pull 的日记与云端日记写入

- 本地 pull 使用 `merge_diary()`：今日内容清洗后优先保留更长内容；归档按日期合并，保留更完整内容、较高浏览数和较高标签分。
- 云端 `POST /api/diary` 使用 `mergeDiaryUpdate()`：旧客户端正文更新由服务端生成确认时间，按最后到达的有效保存处理；带 `expectedUpdatedAt` 的客户端先校验基线。显式有时间戳的空内容可以清空，无时间戳的空内容不会覆盖已有正文。
- 今日更新没有标签字段时保留已有标签；带标签时评分合并取最高分。归档按日期合并并按日期升序排列，空正文过滤。
- 正常保存没有批量删除日记历史的接口；归档合并去重与空内容过滤仍可能改变列表，不能写成“永不删除任何条目”。
- Apple App 保存前比较草稿基线版本，并发送 `expectedUpdatedAt`；服务端在同一事务再次校验，冲突返回 409 和云端今日正文，Mac 保留草稿。保存成功使用服务端确认时间。

### 阅读统计

云端与本地同步当前维护不同的获取实现。云端脚本合并每日阅读记录时取较高秒数，笔记或统计获取失败时回退已有云端数据。

`wereadStats`、`time.weread` 与顶层 `weekReadDaily` / `weekReadMinutes` 存在兼容重复；`weekRead*` 当前实际按月份聚合。更改字段或合并流程前核对各端消费者和测试。

## 归档、缓存与备份

日记的有效日期以 05:00 为分界，跨日后非空今日内容加入归档，今日重置为空内容。Worker 与 Swift 显式使用上海时间；本地 Python 和部分小程序日期函数使用设备时区，设备时区不同会造成边界不一致。

Apple App 与 Widget 通过 App Group 共享账号绑定的缓存和最长 120 秒的待传播写入回执。只在摘要接口 404 时回退完整接口；配置变化后拒绝旧响应，断网时保留真实缓存。相关规则和验收记录见 [Apple 构建说明](../../Apple客户端/Docs/BUILD.md)。

本地 `write_json_file()` 本身不备份；日记和阅读笔记 store 显式调用 `backup_file(..., keep=1)`。任务、时间和阅读书架没有统一自动备份，本地 pull 也不是云端所有数据的完整备份。

## 修改前检查

- 保留“本地旧快照不得自动推云端”的边界。
- 小程序跨 Tab 日记写后读：先等待 `waitForDiarySaves()`，再读取；不要绕开 API 层保存队列。
- 原生 App 的待传播回执、配置隔离和草稿保护要保留。
- 所有数据 API 与 Cron 必须走同一个 TaskState；不能只改写入而继续从旧 KV 读取。缺少 `_base` 的整组保存必须携带匹配的 `_revision`，旧快照或无版本写入返回 409。旧网页需刷新获取新客户端。
- 同步脚本位于 `web/sync/`，设置脚本调用 `web/install_autostart.sh`；本地静态页读取 `web/dashboard.html`。移动这些入口时同时检查工作流、导入与根目录定位。
- 模拟检查、编译、线上部署、真机验收分别记录；详见 [README 开发经验](../../README.md#开发经验备忘)。

## 本次客户端刷新

Mac/iOS App 前台进入立即刷新，前台每 15 秒检查 `/api/sync-state`；版本未变不下载完整书架/日记，变化才拉完整数据。旧 Worker 的版本接口 404 时退回完整拉取。后台取消循环，网络失败保留缓存与草稿并在状态栏提示，不反复弹窗。小组件仍采用 WidgetKit 系统调度和 App 发布缓存。

网页仅在用户数据发生变化时排队保存，收到服务端回执后合并保存期间的新编辑；前台 GET 不覆盖尚未保存的内容。日记计时器执行后清空引用，避免持续阻止读取。

本次源码的 Worker/网页/阅读脚本需要配套发布，不能把本地测试或 dry-run 当作上线。本次回归包含服务端并发、旧快照、日记竞态、超大 Unicode 数据、网页回执合并和 Apple 离线同步；发布前迁移备份及发布后实机验收见 Apple 文档。

## 2026-10-07 网页模块源码变更（未部署）

网页源码拆为 `web/src/core/`、`app/` 与任务/日记/读书模块，构建仍输出原静态入口。日记草稿按连接、Tab 与日期持久化；只写 `/api/diary/entry`，正文/确认时间原子比较，错误不回退无保护接口。学习书籍编辑只发送变动字段与原基线，删除比较整条记录，任务快照不再包含书籍。前台使用统一版本监视，失败保留原数据。详见 [网页模块](../README.md)。

本地按日期日记保存仅落盘本地，在同一进程锁内读取、比较和写入，保留原始正文和元数据；它不替代云端事务，也不自动推送。本地有效日记日期现显式采用上海时区。云端学习书籍写入需配套保护能力，Python 服务暂不提供；网页保留草稿并显示原因。

## 2026-10-07 三端日记版本化同步（源码更新，未部署）

Apple、云端网页与小程序改用 `POST /api/diary/sync`（后端声明 `syncVersion: 1` 时）。服务端自动合并不重叠的原文修改；同处修改、未知基线或比较超预算时事务内保全双方版本，再采用当前提交。`GET /api/diary/versions` 提供经过认证的原文历史。

版本、当前正文与去重回执在 TaskState 事务内统一保存。客户端先落本机不可变操作，丢回执后按原 ID / 载荷重试，不重复覆盖后续修改。各端均有恢复入口，并保护保存期间的较晚输入。旧 CAS / 遗留正文写入在新版后端也保存前后正文；元数据修改不生成正文副本。

本地 Python 仍不支持这一协议，也不自动上传。以上规则仅在新服务端上线后启用，不能把本地旧“较长正文优先”的 pull 规则当作云端多端合并算法。详细来源和设计见 [多端日记同步设计](../../docs/多端日记同步设计.md)。

## 2026-10-07 三端配套发布记录

用户授权配套发布后，Worker / 云端网页已上线，Worker 版本 `9cb8a5af-4807-4c4d-a9c3-9c00150e3a6d`，原 TaskState / KV binding、域名和 Cron 保持，不做存储迁移。日记 `syncVersion: 1` 与同步状态 `diarySyncVersion: 1` 已确认；版本历史读取 200，未认证读取 401。

线上网页与实际发布 HTML 模块一致（域名响应另含原有 Cloudflare 统计脚本注入）。核对以发布模块为准，不使用发布后其他工作仍可能修改的本地 HTML 误判。发布前后完整任务 / 阅读数据、日记正文及归档、文章内容一致；仅日记读取与同步状态新增能力元数据。未创建或修改测试日记。

已安装 Mac 0.4.8（19）对正式服务只读同步成功：28 条任务、58 本书、362 条笔记、469 篇日记归档、1 个小组件，App Group 可用。切回前台或点击同步会读取新能力并启用自动处理。已打开的旧网页刷新后加载新版。

小程序 1.3.7 开发版已上传原 AppID `wx3d9fea31502b4488`，CLI 返回 `✔ upload`，包大小 129409 字节，构建标识 `20261007-diary-automatic-sync`。57 项检查通过；正式版仍需微信公众平台审核 / 发布，开发版上传不代表正式版已更新。

业务只读备份、发布前后 SHA-256 清单、实际发布 HTML、接口验收、Mac 诊断、上传回执及小程序 dist 清单位于忽略目录 `data/archives/diary-automatic-release-20261007/`。旧 Worker 模块备份位于 `/private/tmp/DiaryAutomaticReleaseLiveWorker`。回退应保留 TaskState 与版本正文，不回退读取旧 KV。


2026-10-07：安静自动同步、今天日记短暂空白的发布绑定回退原因、后台重试及发布定版校验，详见 `docs/多端日记同步设计.md` 的最新修复记录。日常不要求用户点击同步。
