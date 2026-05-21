#!/bin/bash
# 卸载微信读书 reader 自动打开的 LaunchAgent

PLIST_NAME="com.yangminggu.wereadreader"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "✅ 已停止 reader 自动打开服务" || echo "reader 自动打开服务未在运行"
rm -f "$PLIST_PATH" && echo "✅ 已删除 reader 自动打开配置" || echo "配置文件不存在"
