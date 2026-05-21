#!/bin/bash
# 一键同步日记：先拉云端合并，再把本地推上去
set -e

API_TOKEN="yhRvd9AGngE6Q2KvbQkP2aJMwDHVyFeChzsZJ7yo8S4"
CLOUD="https://yangminggu.com/tasks"
DIARY_FILE="$(dirname "$0")/../data/diary.json"

echo "📥 Step 1: 从云端拉取日记..."
CLOUD_DIARY=$(curl -s "$CLOUD/api/diary" -H "Authorization: Bearer $API_TOKEN")

echo "🔀 Step 2: 合并云端日记到本地..."
python3 - "$DIARY_FILE" "$CLOUD_DIARY" << 'PYEOF'
import json, sys

local_path = sys.argv[1]
cloud_raw  = sys.argv[2]

with open(local_path) as f:
    local = json.load(f)

try:
    cloud = json.loads(cloud_raw)
except:
    print("   云端数据为空，跳过合并")
    sys.exit(0)

def normalize(d):
    if not isinstance(d, dict):
        return {"today": {}, "archive": []}
    return {
        "today":   d.get("today") or {},
        "archive": [e for e in (d.get("archive") or []) if isinstance(e, dict) and e.get("date")]
    }

local = normalize(local)
cloud = normalize(cloud)

# today：取内容更长的
lt = local["today"].get("content", "")
ct = cloud["today"].get("content", "")
merged_today = cloud["today"] if len(ct) > len(lt) else local["today"]

# archive：按日期合并，内容更长的优先
amap = {e["date"]: e for e in local["archive"]}
for e in cloud["archive"]:
    d = e.get("date")
    if not d: continue
    if d not in amap or len(str(e.get("content",""))) > len(str(amap[d].get("content",""))):
        amap[d] = e

merged = {
    "today":   merged_today,
    "archive": sorted(amap.values(), key=lambda x: x["date"])
}

with open(local_path, "w") as f:
    json.dump(merged, f, ensure_ascii=False, indent=2)

print(f"   合并完成：archive 共 {len(merged['archive'])} 篇")
PYEOF

echo "📤 Step 3: 推送到云端..."
RESULT=$(curl -s -X POST "$CLOUD/api/diary" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$DIARY_FILE")

echo "   结果: $RESULT"
echo ""
echo "✅ 完成！小程序重新进入日记页即可看到过往日记。"
echo ""
echo "--- 最后5篇归档 ---"
python3 -c "
import json
with open('$DIARY_FILE') as f:
    d = json.load(f)
for e in d['archive'][-5:]:
    print(f'  {e[\"date\"]}: {e[\"content\"][:40]}')
"
