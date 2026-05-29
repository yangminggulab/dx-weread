# Agent Usage Monitor

一个独立的 Claude Code + OpenAI Codex 用量监控原型。它默认读取本机 session JSONL，只聚合元数据和 token 用量，不把 prompt、工具输出、正文内容展示到页面。

## 运行

```bash
npm start
```

打开 `http://127.0.0.1:8765`。

也可以只在命令行输出聚合数据：

```bash
npm run scan -- 30
```

## 数据来源

- Codex local JSONL：`~/.codex/sessions` 和 `~/.codex/archived_sessions`
- Claude local JSONL：`~/.claude/projects`
- OpenAI Usage API：可选。设置 `OPENAI_ADMIN_KEY` 后会请求 `/v1/organization/usage/completions`

Claude Code 官方推荐用 OpenTelemetry 做组织级监控；本原型先用本地 JSONL 做轻量聚合，后续可以接 OTel collector。OpenAI 官方 Usage API 提供组织级用量，Costs endpoint 更适合财务对账。

## 当前能力

- 按天统计 token
- 按 Claude Code / Codex / OpenAI API 分组
- 按模型统计 input、cached input、output、估算成本
- 展示最近 session 的工具名、模型、路径、token，不展示对话内容
- 支持 `OPENAI_ADMIN_KEY` 拉取 OpenAI 组织级 completions usage

## 成本说明

`data/pricing.json` 里内置了部分 OpenAI Codex 模型的价格，用于本地估算。Claude Code 本地 JSONL 当前只稳定聚合 token，成本默认显示 `N/A`，因为不同订阅/API/Bedrock/Vertex 路径的实际计费口径不同。

## 参考资料

- OpenAI Usage API: https://platform.openai.com/docs/api-reference/usage
- OpenAI Costs API: https://platform.openai.com/docs/api-reference/usage/costs
- OpenAI Pricing: https://platform.openai.com/docs/pricing
- Claude Code Monitoring: https://code.claude.com/docs/en/monitoring-usage
- Claude Code Costs: https://code.claude.com/docs/en/costs
