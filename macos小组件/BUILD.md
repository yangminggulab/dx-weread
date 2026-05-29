# 构建说明

当前目录已经包含 macOS SwiftUI 宿主 App、WidgetKit Extension、共享模型/API/缓存代码，以及 XcodeGen 工程描述。

## 目录

```text
App/                 macOS 宿主 App，用来保存 Worker API 配置和手动刷新 Widget
iOSApp/              iOS 宿主 App，用来保存 Worker API 配置和手动刷新 iPhone Widget
WidgetExtension/     WidgetKit 小组件，支持 small / medium / large
Shared/              Worker API、数据模型、统计快照、App Group 缓存、圆环视图
Config/              Info.plist 和 entitlements
project.yml          XcodeGen 工程描述
```

## 生成 Xcode 工程

需要先安装 Xcode 15 或更新版本，以及 XcodeGen：

```bash
brew install xcodegen
cd macos小组件
xcodegen generate
open TaskWidget.xcodeproj
```

打开工程后需要检查：

- `Signing & Capabilities` 里的 Team。
- App Group：`group.com.yangminggu.taskwidget`。如果团队账号要求不同前缀，需要同步改 `Shared/WidgetSettings.swift` 和两个 entitlements。
- Widget 目标是否嵌入到 `TaskWidgetApp`。

## 运行方式

1. 先运行 `TaskWidgetApp`。
2. 在 App 里填 Worker API 地址，默认是 `https://yangminggu.com/tasks`。
3. 填 API Token 后点“测试并刷新”。
4. 到 macOS 桌面编辑小组件，添加“任务阅读”。

## iPhone 版本

工程里同时包含 iOS targets：

- `TaskWidgetiOS`
- `TaskWidgetiOSWidgetExtension`

连接 iPhone 后，在 Xcode 顶部选择 `TaskWidgetiOS` scheme，选择你的 iPhone 作为运行目标，然后运行。首次安装后，在 iPhone 桌面长按空白处，点 `+`，搜索“任务阅读”添加小组件。

注意：真机安装 iOS App / Widget 必须在 Xcode 里给 `TaskWidgetiOS` 和 `TaskWidgetiOSWidgetExtension` 配好 Team 和 App Group。命令行 `CODE_SIGNING_ALLOWED=NO` 只能验证代码能编译，不能安装到手机。

## 已实现

- `GET /api/data` 拉取 Cloudflare Worker 数据。
- 今日任务完成率。
- 今日阅读分钟 / 30 分钟目标圆环。
- 连续完成天数、累积完成天数。
- 高优先级待办列表。
- App Group 缓存，网络失败时 Widget 使用上次数据。
- 点击 Widget 通过 `taskwidget://dashboard` 打开宿主 App。
- macOS 与 iOS 共用 `Shared/` 和 `WidgetExtension/`。

## 下一步

- Worker 增加 `GET /api/widget-summary`，避免 Widget 拉完整数据。
- 让只读接口也校验 Bearer token。
- 用 Keychain + Access Group 保存 token，替代当前 MVP 的 App Group UserDefaults。
- 第二阶段再用 App Intents 支持“勾选完成任务”。
