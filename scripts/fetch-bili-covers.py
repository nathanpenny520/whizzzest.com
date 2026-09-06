#!/usr/bin/env python3
"""
fetch-bili-covers.py — 从B站批量拉取视频元数据与封面（docs/万载TV方案.md）

后台「从B站获取信息」按钮的批量版，幂等可重跑：
  1. 调 api.bilibili.com/x/web-interface/view 取 title / desc / duration / pic
  2. 下载封面到 $WORK/<bvid>.jpg（B站图床对无 Referer 的服务端请求放行，转存 R2 绕开防盗链）
  3. 生成两份产物（$WORK 默认 /tmp/bili-covers）：
     - put.sh     ：wrangler r2 object put 上传封面到 whizzzest-media/tv/c-bili-<bvid>.jpg
     - update.sql ：回填 D1（标题/简介/时长/每集封面；--series-cover <bv> 另写剧集总封面 video_series）

用法：
  python3 scripts/fetch-bili-covers.py BV1xxx BV1yyy [--series-cover BV1xxx]
  bash /tmp/bili-covers/put.sh
  npx wrangler d1 execute whizzzest --remote --file=/tmp/bili-covers/update.sql -y
"""
import json
import os
import sys
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
WORK = "/tmp/bili-covers"
SERIES_NAME = "一朝相逢便是万载"


def api(bvid):
    req = urllib.request.Request(
        f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}",
        headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.load(r)
    if d.get("code") != 0:
        raise RuntimeError(f"B站 API code={d.get('code')} {d.get('message')}")
    return d["data"]


def sql(s):
    return "'" + str(s or "").replace("'", "''") + "'"


def main():
    args = sys.argv[1:]
    series_bv = None
    if "--series-cover" in args:
        i = args.index("--series-cover")
        series_bv = args[i + 1]
        args = args[:i] + args[i + 2:]
    if not args:
        sys.exit("用法：fetch-bili-covers.py BV1xxx ... [--series-cover BV1xxx]")

    os.makedirs(WORK, exist_ok=True)
    puts, updates = [], []
    first_series_cover = None

    for bvid in args:
        info = api(bvid)
        pic = (info.get("pic") or "").replace("http://", "https://")
        path = os.path.join(WORK, f"{bvid}.jpg")
        if pic:
            req = urllib.request.Request(pic, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r, open(path, "wb") as f:
                f.write(r.read())
            puts.append(
                f"npx wrangler r2 object put whizzzest-media/tv/c-bili-{bvid}.jpg "
                f"--file {path} --remote --content-type image/jpeg"
            )
        key = f"tv/c-bili-{bvid}.jpg" if pic else None
        updates.append(
            "UPDATE videos SET title = {t}, intro = {i}, duration = {d}, cover = {c}, "
            "updated_at = datetime('now') WHERE bvid = {b};".format(
                t=sql(info.get("title")), i=sql(info.get("desc")),
                d=int(info.get("duration") or 0), c=sql(key), b=sql(bvid),
            )
        )
        if bvid == series_bv and key:
            first_series_cover = key
        print(f"  {bvid}: {info.get('title')} · {info.get('duration')}s · 封面 {'✓' if pic else '✗'}")

    if first_series_cover:
        updates.append(
            "INSERT INTO video_series (name, cover) VALUES ({n}, {c}) "
            "ON CONFLICT(name) DO UPDATE SET cover = {c}, updated_at = datetime('now');".format(
                n=sql(SERIES_NAME), c=sql(first_series_cover),
            )
        )

    with open(os.path.join(WORK, "put.sh"), "w") as f:
        f.write("set -e\n" + "\n".join(puts) + "\n")
    with open(os.path.join(WORK, "update.sql"), "w") as f:
        f.write("\n".join(updates) + "\n")
    print(f"\n产物：{WORK}/put.sh（{len(puts)} 个封面上传）+ update.sql（{len(updates)} 条 SQL）")


if __name__ == "__main__":
    main()
