#!/bin/bash
# 安装一个 macOS LaunchAgent，定时打开微信读书 reader 页面，
# 让 Chrome 扩展自动捕获阅读请求模板 / 触发本地同步。
#
# 用法:
#   bash scripts/install_weread_reader_autostart.sh
#
# 可选环境变量:
#   WEREAD_OPEN_INTERVAL_SECONDS=86400   # 默认每天一次

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$(which python3)"
PLIST_NAME="com.yangminggu.wereadreader"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$PROJECT_DIR/logs"
INTERVAL="${WEREAD_OPEN_INTERVAL_SECONDS:-86400}"

mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON}</string>
        <string>${PROJECT_DIR}/scripts/open_weread_reader.py</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>StartInterval</key>
    <integer>${INTERVAL}</integer>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/weread_reader.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/weread_reader.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "✅ 微信读书 reader 自动打开已安装"
echo "   服务名：${PLIST_NAME}"
echo "   间隔：${INTERVAL} 秒"
echo "   日志：${LOG_DIR}/weread_reader.log"
echo ""
echo "说明："
echo "  1. 先确保本地 server.py 自启动已安装"
echo "  2. 先手动打开一次微信读书正文页，让扩展捕获 reader 模板"
echo "  3. 之后这个定时任务会自动打开 reader 页，无需手点插件"
