#!/bin/bash
# 把 server.py 注册为 macOS 登录时自动启动的后台服务
# 用法: bash scripts/install_autostart.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -x "$PROJECT_DIR/.venv/bin/python" ]; then
  PYTHON="$PROJECT_DIR/.venv/bin/python"
else
  PYTHON="$(which python3)"
fi
PLIST_NAME="com.yangminggu.taskserver"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$PROJECT_DIR/logs"

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
        <string>${PROJECT_DIR}/web/server.py</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/server.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/server.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

# 如果已在运行先卸载
launchctl unload "$PLIST_PATH" 2>/dev/null || true

# 加载新配置
launchctl load "$PLIST_PATH"

echo "✅ 自启动已安装"
echo "   服务名：${PLIST_NAME}"
echo "   日志：${LOG_DIR}/server.log"
echo ""
echo "常用命令："
echo "  查看状态：launchctl list | grep yangminggu"
echo "  手动停止：launchctl unload ~/Library/LaunchAgents/${PLIST_NAME}.plist"
echo "  手动启动：launchctl load ~/Library/LaunchAgents/${PLIST_NAME}.plist"
echo "  卸载自启：bash scripts/uninstall_autostart.sh"
