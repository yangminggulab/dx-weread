# 杨明谷任务管理 · 微信小程序

## 项目结构
```
miniprogram/
├── src/
│   ├── app.js / app.config.js / app.scss   # 全局配置
│   ├── api/index.js                         # 接口层（调用 Cloudflare Worker）
│   └── pages/
│       ├── index/   # 任务页
│       ├── books/   # 书单页
│       └── notes/   # 笔记页
├── config/          # Taro 构建配置
├── project.config.json   # 微信开发者工具配置（含 AppID）
└── package.json
```

## 第一步：安装依赖

```bash
cd miniprogram
npm install
```

## 第二步：构建小程序

```bash
npm run build:weapp
# 或开发模式（实时监听）：
npm run dev:weapp
```

构建完成后会生成 `dist/` 目录。

## 第三步：微信开发者工具

1. 下载安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开工具 → 「导入项目」
3. 目录选择：`miniprogram/dist`（不是 src！）
4. AppID 填：`wx3d9fea31502b4488`
5. 点「导入」即可预览

## 第四步：配置请求域名白名单

在微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名，
将 `https://yangminggu.com` 添加到 **request合法域名**。

> ⚠️ 不配置此项，小程序真机调试时 API 请求会被拦截。

## TabBar 图标

`src/assets/icons/` 目录下需放置 6 张 PNG 图标（81x81px，透明背景）：
- `task.png` / `task_active.png`
- `book.png` / `book_active.png`
- `note.png` / `note_active.png`

可以从 [iconfont.cn](https://www.iconfont.cn) 免费下载，选择线性/双色风格。

## API 说明

所有数据通过 `https://yangminggu.com/tasks/api/data` 存取，
复用原有 Cloudflare Worker + KV 存储，无需修改后端。
