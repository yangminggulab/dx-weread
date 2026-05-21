#!/bin/bash
# 卸载 server.py 的开机自启动
PLIST_NAME="com.yangminggu.taskserver"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "✅ 已停止服务" || echo "服务未在运行"
rm -f "$PLIST_PATH" && echo "✅ 已删除自启动配置" || echo "配置文件不存在"
