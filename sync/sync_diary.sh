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

DIARY_TAGS = [
    "学习卡壳",
    "复习考试",
    "焦虑内耗",
    "灾难化",
    "失眠亢奋",
    "安静恢复",
    "计划执行",
    "决策止损",
    "求职面试",
    "人际边界",
]

def normalize_scores(entry):
    scores = {}
    raw_scores = entry.get("tagScores") if isinstance(entry.get("tagScores"), dict) else {}
    for tag in DIARY_TAGS:
        try:
            score = max(0, min(5, int(raw_scores.get(tag, 0))))
        except (TypeError, ValueError):
            score = 0
        if score > 0:
            scores[tag] = score
    for tag in entry.get("tags") or []:
        if tag in DIARY_TAGS and tag not in scores:
            scores[tag] = 1
    return scores

def merge_entry(local_entry, cloud_entry):
    local_entry = local_entry or {}
    cloud_entry = cloud_entry or {}
    lc = str(local_entry.get("content", ""))
    cc = str(cloud_entry.get("content", ""))
    primary = cloud_entry if len(cc) > len(lc) else local_entry
    secondary = local_entry if primary is cloud_entry else cloud_entry
    scores = {}
    local_scores = normalize_scores(local_entry)
    cloud_scores = normalize_scores(cloud_entry)
    for tag in DIARY_TAGS:
        score = max(local_scores.get(tag, 0), cloud_scores.get(tag, 0))
        if score > 0:
            scores[tag] = score
    merged = {**secondary, **primary}
    merged["tags"] = [tag for tag in DIARY_TAGS if scores.get(tag, 0) > 0]
    merged["tagScores"] = scores
    return merged

local = normalize(local)
cloud = normalize(cloud)

# today：内容取更长的，标签评分合并取高分
merged_today = merge_entry(local["today"], cloud["today"])

# archive：按日期合并，内容更长的优先，标签评分合并取高分
amap = {e["date"]: e for e in local["archive"]}
for e in cloud["archive"]:
    d = e.get("date")
    if not d: continue
    if d in amap:
        amap[d] = merge_entry(amap[d], e)
    else:
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
