# Usage Monitor 模块 TODO

## 集成到网页版任务面板

目标：把当前 `usage-monitor` 的能力集成到 `https://yangminggu.com/tasks` 网页版，而不是只作为独立页面运行。

### 入口位置

- 在网页版顶部导航栏增加一个 Usage 入口。
- 入口放在“数学笔记”旁边，保持和现有导航风格一致。
- 点击 Usage 后不跳转页面，优先以下拉面板展示。

### 展示方式

- 下拉面板中展示两个 usage 环：
  - Claude Code usage
  - Codex / OpenAI usage
- 如果环形图不适合当前数据结构，可以改成更易读的小型统计组件，例如 token 总量、今日/本周用量、缓存命中 token、估算成本。
- 面板只展示元数据和 token/cost 汇总，不展示 prompt、工具输出或对话正文。

### 数据接口

- 复用当前 `usage-monitor` 的聚合逻辑：`buildUsageReport`。
- 在网页版后端增加一个只读 API，例如 `GET /api/usage-summary`。
- 默认统计窗口可先使用 30 天，后续再加日/周/月切换。
- 如果接入 OpenAI Usage API，需要通过服务端环境变量配置 `OPENAI_ADMIN_KEY`，不要暴露到前端。

### 后续实现步骤

- 确认 `https://yangminggu.com/tasks` 的顶部导航实现位置。
- 把 `usage-monitor/lib/usage.js` 的聚合逻辑移动或封装成可被主 Web 服务复用的模块。
- 新增网页版 API，返回适合顶部下拉面板使用的精简数据。
- 在顶部导航“数学笔记”旁边新增 Usage 按钮和下拉面板。
- 实现两个环形 usage 组件，并补充空状态、加载状态和错误状态。
- 部署前确认本地日志路径、权限和生产环境数据来源策略。
