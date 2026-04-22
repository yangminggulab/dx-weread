# WeRead Sync Helper

这是给本地任务管理 App 用的 Chrome 扩展。

## 安装 / 更新扩展

> **注意：** 每次修改扩展文件后，必须在 Chrome 里刷新/重新加载扩展，否则改动不会生效。

### 首次安装（推荐：开发者模式加载）

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 打开右上角 **”开发者模式”**。
3. 点击 **”加载已解压的扩展程序”**。
4. 选择本目录：`chrome-extension/weread-sync`

### 更新已有扩展（修改代码后必做）

1. 进入 `chrome://extensions/`。
2. 找到 “WeRead Sync Helper”，点击右下角的 **刷新图标 ↺**。
3. 如果刷新后弹出”请求新权限”提示，点击 **”允许”** —— 因为新版扩展增加了 `*.qq.com` 和 `alarms` 权限，用于读取微信读书 Cookie 与后台自动同步。

## 使用

1. 先运行本地服务：
   `python3 server.py`
2. 在 Chrome 登录 `https://weread.qq.com`。
3. 打开任意微信读书页面，扩展会在后台自动抓取 Cookie 并同步。
4. 如果想立即触发一次，也可以点击扩展图标 `WeRead Sync Helper`，再点“立即同步”。

扩展会：

- 从 Chrome 当前登录态读取 `weread.qq.com` 的 Cookie
- 发给本地 `http://127.0.0.1:8080/api/weread/extension-sync`
- 把同步结果写进 `data.json`
- 保存 Cookie 到 `.weread_cookie.json`
- 自动刷新已打开的本地应用页面
- 每 30 分钟在后台重试一次自动同步
