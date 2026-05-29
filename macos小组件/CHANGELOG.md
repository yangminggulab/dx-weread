# 变更日志

## 2026-05-29

- 新增 `macos小组件/` 原生 SwiftUI + WidgetKit 工程骨架。
- 新增 macOS 宿主 App 与 macOS Widget Extension，展示今日任务、阅读圆环、连续/累计阅读天数和高优先级待办。
- 新增 iOS 宿主 App 与 iOS Widget Extension targets，共用 `Shared/` 数据模型、Worker API、缓存和 Widget UI。
- 使用 Cloudflare Worker `GET /api/data` 作为 MVP 数据源，保留后续 `/api/widget-summary` 优化建议。
- 增加 XcodeGen `project.yml`、构建说明和验证后删除清单。
- 已用 Xcode 16.4 验证：
  - `TaskWidgetApp` macOS Debug 无签名编译通过。
  - `TaskWidgetiOS` generic iOS 无签名编译通过。
  - macOS/iOS Widget extension 产物均包含 `com.apple.widgetkit-extension`。

备注：真正添加到 macOS/iPhone 小组件面板，需要在 Xcode 中配置 Apple ID Team 和 App Group 后运行宿主 App；本机当前无有效 Apple Development 签名身份。
