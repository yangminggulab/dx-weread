#!/bin/bash
# 配置纯本地微信读书自动同步，并注册 server.py 开机自启
# 用法: bash scripts/setup_local_weread_sync.sh [间隔小时]

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
INTERVAL_HOURS="${1:-2}"

touch "$ENV_FILE"

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$ENV_FILE"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { done=0 }
      $0 ~ ("^" key "=") {
        print key "=" value
        done=1
        next
      }
      { print }
      END {
        if (!done) print key "=" value
      }
    ' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf "%s=%s\n" "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

upsert_env "WEREAD_SYNC_MODE" "local-only"
upsert_env "WEREAD_ENABLE_GITHUB_SECRET_SYNC" "0"
upsert_env "WEREAD_AUTO_SYNC_SOURCE" "saved-cookie"
upsert_env "WEREAD_AUTO_SYNC_INTERVAL_HOURS" "$INTERVAL_HOURS"
upsert_env "WEREAD_AUTO_SYNC_START_DELAY_SECONDS" "15"
upsert_env "WEREAD_AUTO_SYNC_ON_START" "1"

bash "$PROJECT_DIR/scripts/install_autostart.sh"

echo ""
echo "✅ 已切换到纯本地自动同步模式"
echo "   间隔：${INTERVAL_HOURS} 小时"
echo "   配置文件：${ENV_FILE}"
echo ""
echo "下一步建议："
echo "  1. 访问 http://127.0.0.1:8080/dashboard.html"
echo "  2. 首次任选其一：手动粘贴 Cookie，或点“从 Chrome 自动同步”"
echo "  3. 后续后台会直接使用本地已保存 Cookie 自动同步，不再要求系统密码"
