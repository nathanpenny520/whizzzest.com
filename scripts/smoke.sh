#!/usr/bin/env bash
# 部署后冒烟检查（只读）——本地手动工具：bash scripts/smoke.sh
#
# 注：CI 自动冒烟已于 2026-09-08 移除——站点边缘机器人防护会质询数据中心 IP 的
# 非浏览器请求（403 + cf-mitigated: challenge），GitHub Runner 无法穿透；
# 浏览器访客与 /assets/* 静态资产不受影响。本地（住宅 IP）可正常全量检查。
#
# 安全边界（不阻碍/不污染线上）：
#   - 全部为 GET 请求；页面请求显式带 Accept: */*，不满足 Worker 访客采集的
#     「文档导航」判定（worker/index.js：需要 dest=document 或 Accept 含 text/html），
#     因此不会写入 D1 访客统计
#   - 不打任何 POST / AI 推理接口（/api/ai/chat 等一概不碰）
#   - 每项检查带重试，容忍部署后边缘传播的数秒抖动
#
# 环境变量：
#   BASE_URL           主站地址（默认 https://whizzzest.com）
#   SMOKE_FINGERPRINT  为 true 时比对本地 dist/build-meta.json 的 6 项资产指纹与
#                      生产实际返回，校验「本次部署真的上线了」
#                      （dist 不进 git，需先跑 node build.js 取得本次构建指纹）
#   DIST_DIR           本地构建产物目录（默认 dist）
set -u

BASE_URL="${BASE_URL:-https://whizzzest.com}"
SMOKE_FINGERPRINT="${SMOKE_FINGERPRINT:-false}"
DIST_DIR="${DIST_DIR:-dist}"
ATTEMPTS=3   # 每项检查重试次数
RETRY_GAP=6  # 重试间隔（秒）

PASS=0
FAIL=0
ROWS=()
FAILURES=()

# 浏览器 UA：部分边缘安全特性（安全级别/UA 规则）会质询非浏览器流量；
# 尾缀 whizzzest-smoke 便于在 Cloudflare 日志中识别本检查流量。
# 注意 Accept 仍为 */*：不满足访客采集的文档导航判定，不写 D1 统计。
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 whizzzest-smoke'

md5_8() {
  # 与 build.js 的指纹算法一致：内容 md5 前 8 位（node 保证 macOS/CI 通用）
  node -e "const c=require('crypto');const d=[];process.stdin.on('data',b=>d.push(b));process.stdin.on('end',()=>console.log(c.createHash('md5').update(Buffer.concat(d)).digest('hex').slice(0,8)))"
}

# 取 HTTP 状态码 + curl 退出码；输出 "状态 curl_rc=N"（rc=6 DNS / 7 连接失败 / 28 超时）
get_status() {
  local out
  out=$(curl -sS -o /dev/null -m 20 -w '%{http_code}' -A "$UA" -H 'Accept: */*' "$1" 2>/dev/null)
  echo "${out:-000} curl_rc=$?"
}

# 失败诊断：打印关键响应头与响应体片段，用于判断是否被边缘质询（cf-mitigated: challenge）
diag() {
  local url="$1"
  local body="/tmp/smoke-diag-body.$$"
  echo "--- 诊断 $url ---"
  curl -sS -m 20 -A "$UA" -H 'Accept: */*' -D - -o "$body" "$url" 2>&1 |
    grep -iE '^(HTTP/|cf-mitigated:|server:|cf-ray:)' | head -6
  echo "body 前 200 字节: $(head -c 200 "$body" 2>/dev/null | tr '\n\r' '  ')"
  rm -f "$body"
}

# check <名称> <URL> <期望: 200 | 301 | 404 | ok(2xx/3xx)>
check() {
  local name="$1" url="$2" expect="$3" attempt status pass want
  case "$expect" in
    ok)  want='2xx/3xx' ;;
    *)   want="$expect" ;;
  esac
  pass=0
  for attempt in $(seq 1 "$ATTEMPTS"); do
    read -r status rcinfo <<< "$(get_status "$url")"
    case "$expect" in
      ok)  case "$status" in 2*|3*) pass=1 ;; esac ;;
      *)   [ "$status" = "$expect" ] && pass=1 ;;
    esac
    [ "$pass" = 1 ] && break
    [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$RETRY_GAP"
  done
  if [ "$pass" = 1 ]; then
    PASS=$((PASS + 1))
    ROWS+=("| ✅ | $name | \`${status}\` |")
  else
    FAIL=$((FAIL + 1))
    ROWS+=("| ❌ | $name | \`${status}\`/${rcinfo}（期望 ${want}） |")
    FAILURES+=("$name → \`$url\` 返回 ${status}（${rcinfo}），期望 ${want}")
    diag "$url"
  fi
}

# 指纹校验：比对 build-meta.json 中每个资产的生产内容 md5 与本地构建是否一致
fp_check() {
  local meta="$DIST_DIR/build-meta.json"
  if [ ! -f "$meta" ]; then
    FAIL=$((FAIL + 1))
    ROWS+=("| ❌ | 资产指纹校验 | 未找到 \`$meta\` |")
    FAILURES+=("资产指纹校验 → 本地构建产物缺失 $meta")
    return
  fi
  local round path expected actual mismatches
  mismatches="init"
  for round in $(seq 1 "$ATTEMPTS"); do
    mismatches=""
    while read -r path expected; do
      [ -n "$path" ] || continue
      actual=$(curl -sS -m 20 -A "$UA" "$BASE_URL$path" 2>/dev/null | md5_8)
      if [ "$actual" != "$expected" ]; then
        mismatches="$mismatches \`$path\`(本地 $expected / 线上 ${actual:-空})"
      fi
    done < <(node -e "const m=require('./'+process.argv[1]);for(const[p,h]of Object.entries(m))console.log(p+' '+h)" "$meta")
    [ -z "$mismatches" ] && break
    [ "$round" -lt "$ATTEMPTS" ] && sleep "$RETRY_GAP"
  done
  if [ -z "$mismatches" ]; then
    PASS=$((PASS + 1))
    ROWS+=("| ✅ | 资产指纹（部署落地校验） | 本地构建 = 线上 |")
  else
    FAIL=$((FAIL + 1))
    ROWS+=("| ❌ | 资产指纹（部署落地校验） | 不一致：$mismatches |")
    FAILURES+=("资产指纹校验 → 线上内容与本次构建不一致，疑似部署未生效或被跳过：$mismatches")
  fi
}

echo "== 部署后冒烟检查：$BASE_URL =="

# 先等几秒，让部署后的边缘配置传播
sleep 5

# --- 主站页面（全部走 Worker 或静态资产，200 = Worker 未 5xx）---
check "首页 /"                       "$BASE_URL/"                       200
check "商户 /merchants"              "$BASE_URL/merchants"              200
check "焰境流光 /tv"                   "$BASE_URL/tv"                     200
check "文库 /library"                "$BASE_URL/library"                200
check "音乐 /music"                  "$BASE_URL/music"                  200
check "景点 /attractions"            "$BASE_URL/attractions"            200
# /digital-fireworks 为纯静态目录（不进 run_worker_first），无斜杠会被资产层 307，故带斜杠请求
check "烟花模拟器 /digital-fireworks" "$BASE_URL/digital-fireworks/"      200
check "sitemap.xml"                  "$BASE_URL/sitemap.xml"            200

# --- D1 绑定探测（纯页面 200 抓不到的绑定/迁移事故）---
check "D1 绑定 /api/stats"           "$BASE_URL/api/stats"              200
check "D1 绑定 /api/tv/latest"       "$BASE_URL/api/tv/latest"          200

# --- 路由行为 ---
check "www 301 跳转"                 "https://www.whizzzest.com/"       301
check "404 页兜底"                   "$BASE_URL/__smoke_not_exist_$(date +%s)" 404

# --- 三个门户 Worker（无会话为登录页 200 或 302，只要不 5xx 即可）---
check "商户门户 merchant"            "https://merchant.whizzzest.com/"  ok
check "作者门户 writer"              "https://writer.whizzzest.com/"    ok
check "管理后台 admin（Access）"     "https://admin.whizzzest.com/"     ok

# --- 部署落地校验 ---
if [ "$SMOKE_FINGERPRINT" = "true" ]; then
  fp_check
else
  ROWS+=("| ⚠️ | 资产指纹（部署落地校验） | 跳过（部署未执行：token 缺失或 deploy job 未产出） |")
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::warning::CLOUDFLARE_API_TOKEN 缺失或 deploy job 未执行，线上仍为旧版本，本次未做部署落地校验"
fi

# --- 输出 summary：表格同时进 stdout（CI 日志可直接看）与 job summary ---
SUMMARY_OUT="${GITHUB_STEP_SUMMARY:-$(mktemp)}"
{
  echo "## 🩺 部署后冒烟检查"
  echo ""
  echo "- 站点：\`$BASE_URL\`"
  echo "- 指纹校验：$([ "$SMOKE_FINGERPRINT" = "true" ] && echo "已执行" || echo "跳过（部署未执行）")"
  echo ""
  echo "| 结果 | 检查项 | 状态 |"
  echo "|---|---|---|"
  for r in "${ROWS[@]}"; do echo "$r"; done
  echo ""
  if [ "${#FAILURES[@]}" -gt 0 ]; then
    echo "**❌ 失败项：**"
    for f in "${FAILURES[@]}"; do echo "- $f"; done
  else
    echo "✅ 全部通过（$PASS 项）"
  fi
} > "$SUMMARY_OUT"
cat "$SUMMARY_OUT"

echo "== 结果：$PASS 通过 / $FAIL 失败 =="
[ "$FAIL" -eq 0 ] || exit 1
