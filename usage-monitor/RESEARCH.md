# Research Notes

## OpenAI / Codex

- OpenAI 的组织级 Usage API 可以按时间桶、模型、项目、用户、API key 等维度拉取 completions 用量。
- OpenAI 另有 Costs endpoint，更适合财务对账，因为 Usage API 的细粒度用量和最终账单可能存在记录口径差异。
- Codex CLI/desktop 是本地运行的 coding agent；本机 session JSONL 中存在 `token_count` 事件，可以作为本机用量估算来源。
- 本原型选择两条路线并存：默认读取本地 Codex JSONL；如果设置 `OPENAI_ADMIN_KEY`，再补充组织级 Usage API。

## Claude Code

- Claude Code 官方推荐通过 OpenTelemetry 导出 metrics、logs/events 和可选 traces。
- 关键指标包括 `claude_code.cost.usage`、`claude_code.token.usage`、session 数、代码行变化、提交/PR 计数、active time 等。
- `/usage` 命令会显示当前 session 的 token/cost 估算；订阅计划下的费用数字不一定等于真实账单。
- 本原型先读取本机 `~/.claude/projects` JSONL 聚合 token。后续更稳的组织级版本应该加 OTel collector。

## Implementation Choice

- 本地优先：不用上传对话内容，适合个人面板。
- 可选官方 API：OpenAI Usage API 只在用户显式提供 `OPENAI_ADMIN_KEY` 时启用。
- 成本估算保持保守：只有 `data/pricing.json` 中有价格的模型才计算成本；其他模型显示 `N/A`。

## CC Switch Learnings

CC Switch 的 usage 模块比简单扫 JSONL 更完整，核心结构是：

- 数据入口统一写入 `proxy_request_logs`，字段覆盖 app、provider、model、input/output/cache tokens、分项成本、状态、时间、data_source。
- Claude session 来源：扫描 `~/.claude/projects`，按 `message.id` 去重，只导入有 `stop_reason` 的最终 assistant 消息。
- Codex session 来源：扫描 `~/.codex/sessions/YYYY/MM/DD/*.jsonl` 和 `archived_sessions`，优先读取 `total_token_usage` 累计值，并计算相邻事件 delta。
- 同步状态：`session_log_sync` 记录每个文件的 `last_modified` 和 `last_line_offset`，实现增量解析。
- 查询层：summary、trend、provider stats、model stats、request logs 都从同一张日志表聚合，前端用 React Query 轮询刷新。
- 成本层：`model_pricing` 存每百万 tokens 的 input/output/cache read/cache creation 价格，更新价格后回填历史成本。
- 长期数据：旧明细 rollup 到 `usage_daily_rollups`，再删除旧的 request 明细，避免数据库无限增长。

我们当前原型已吸收其中两个最重要的本地日志细节：Codex 使用累计 delta，Claude 使用 final message 去重。下一步如果要继续像 CC Switch 一样稳定，应该把扫描结果落到 SQLite，而不是每次请求全量扫本机文件。

## Sources

- https://platform.openai.com/docs/api-reference/usage
- https://platform.openai.com/docs/api-reference/usage/costs
- https://platform.openai.com/docs/pricing
- https://github.com/openai/codex
- https://code.claude.com/docs/en/monitoring-usage
- https://code.claude.com/docs/en/costs
- https://github.com/farion1231/cc-switch
- https://github.com/vyshnavsdeepak/ccswitch
