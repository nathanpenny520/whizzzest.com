#!/usr/bin/env python3
"""内容提取器：旧站 zh-CN.json + locations.ts → 新站 src/data/*.json

来源:
  reference/old-site/packages/frontend/src/locales/zh-CN.json   全部文案
  reference/old-site/packages/frontend/src/data/locations.ts    travelRoutes（旅游线路站点）
产物: src/data/site.json + 每页一个数据文件（字段结构见各文件）
图片/视频映射: 下方 IMG_RULES / VIDEO_BV，以旧站各 Page.vue 实际用到的资源为准。
"""
import json
import os
import re
import subprocess

SRC = "reference/old-site/packages/frontend/src/locales/zh-CN.json"
TS = "reference/old-site/packages/frontend/src/data/locations.ts"
OUT = "src/data"

# 旧板块 key → 图片文件（与旧站 Page.vue 中每个板块实际引用一致）
IMG = {
    "fireworks": "wanzaihuapao.jpg",
    "deshenggu": "deshengu.jpg",
    "xiaBu": "xiabu.png",
    "kaiKouNuo": "kaikounuo.jpeg",
    "zhiPeng": "zhipengshange.jpg",
    # 非遗板块旧站为视频，图片仅作低配回退/海报备用
    "liuDaWan": "liudawan.jpeg",
    "fuGuiYouJuan": "fuguiyoujuan.jpeg",
    "wanzaiZhaRou": "wanzaizha1rou.jpeg",
    "wanzaiZhaRou2": "wanzaizha4rou.jpeg",
    "wanzaiKuaiYu": "wanzaikuaiyu.jpeg",
    "kangLeSanHuangJi": "kanglesanhuangji.jpeg",
    "qingDunHeiShanYang": "qingdunheishanyang.jpeg",
    "luoChenZhaFen": "luochenzhafen.jpeg",
    "wanzaiDuoRou": "wanzaiduorou.jpeg",
    "wanzaiFanYa": "wanzaifanya.jpeg",
    "wanzaiBaiHe": "baiheshenkai.jpeg",
    "biaoXinZhi": "biaoxingzhi.jpeg",
    "nanSuanZaoGao": "nansuanzaogao.jpeg",
}

# 非遗板块视频（CulturePage.vue 中 5 个 B 站 iframe，按页面顺序）
HERITAGE_ORDER = ["fireworks", "deshenggu", "xiaBu", "kaiKouNuo", "zhiPeng"]
VIDEO_BV = {
    "fireworks": "BV1mLL86BEET",
    "deshenggu": "BV1psL86aEJG",
    "xiaBu": "BV1tLL86BEwB",
    "kaiKouNuo": "BV127L86TE24",
    "zhiPeng": "BV127L86TE2o",
}
INDUSTRY_VIDEO = "BV147L86TEvP"  # IndustryPage.vue History Section

DOUYIN_OFFICIAL = "https://www.douyin.com/user/MS4wLjABAAAA0fPcuNv5vy46rDu3W1laQUVvZQiyr9MbDl7E60WUnrOKVkG_JKKy68tZiWA_L3A8"
DOUYIN_WANZAI = "https://www.douyin.com/user/MS4wLjABAAAAhy0jc-hMIansK5QmD-5fikKmvNrSA2qUn9qmDNFTsqOoVZX0TJa4VoLiNU-bBP_f"
XIAOHONGSHU = "https://www.xiaohongshu.com/user/profile/69a2d84a0000000021023fd4"
WEIXIN_SERVICE = "https://work.weixin.qq.com/kfid/kfc339afcb020ce4dd8"


def paras(*vals):
    """过滤空值合并为段落数组"""
    return [v for v in vals if v]


_AR_CACHE = {}


def img_ar(fname):
    """用 macOS 内置 sips 读取图片尺寸，返回 CSS aspect-ratio 值（如 '1200/800'）。
    供模板写 style="aspect-ratio:…"，图片按原始比例完整展示、零裁剪零布局偏移。"""
    if not fname:
        return ""
    if fname in _AR_CACHE:
        return _AR_CACHE[fname]
    p = os.path.join("src/assets/img", fname)
    ar = ""
    if os.path.exists(p):
        out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", p],
                             capture_output=True, text=True).stdout
        w = re.search(r"pixelWidth:\s*(\d+)", out)
        h = re.search(r"pixelHeight:\s*(\d+)", out)
        if w and h:
            ar = f"{w.group(1)}/{h.group(1)}"
    _AR_CACHE[fname] = ar
    return ar


def dish(zh_food, key):
    sec = zh_food["sections"][key]
    img = IMG[key]
    return {"key": key, "title": sec["title"], "paras": paras(sec.get("desc1"), sec.get("desc")), "img": img, "ar": img_ar(img)}


def travel_routes_from_ts():
    """locations.ts 的 travelRoutes → JSON（利用 Node 原生 TS 类型剥离导入）"""
    script = f"""
      const m = await import('../{TS}');
      console.log(JSON.stringify(m.travelRoutes.map(r => ({{
        name: r.name, nameEn: r.nameEn, description: r.description,
        img: '',
        stops: r.locations.map(l => ({{ order: l.order, name: l.name, desc: l.description || '' }})),
      }}))));
    """
    res = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, check=True,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )
    routes = json.loads(res.stdout.strip().splitlines()[-1])
    img_map = {"古城文化之旅": "guc_wenhua_tra.jpg", "山水文化之旅": "shans_wenhua_tra.jpeg", "红色文化之旅": "hongs_wenhua_tra.jpg"}
    for r in routes:
        r["img"] = img_map.get(r["name"], "wanzai_travelling.jpeg")
        r["ar"] = img_ar(r["img"])
    return routes


def main():
    zh = json.load(open(SRC, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    common = zh["common"]
    f = zh["footer"]

    site = {
        "name": zh["siteName"] if isinstance(zh.get("siteName"), str) else "焰境·万载",
        "tagline": zh["home"]["hero"]["title"],
        "email": "whizzzest@outlook.com",
        "nav": [
            {"href": "/", "label": "首页"},
            {"href": "/heritage/", "label": "非遗文化"},
            {"href": "/cuisine/", "label": "美食特产"},
            {"href": "/industry/", "label": "烟花产业"},
            {"href": "/tourism/", "label": "旅游线路"},
            {"href": "/spots/", "label": "赏烟地点"},
            {"href": "/about/", "label": "关于"},
        ],
        "footer": {
            "aboutTitle": f.get("about", "关于焰境·万载"),
            "aboutDesc": f.get("aboutDesc", ""),
            "contact": f.get("contact", "联系我们"),
            "friendLinks": [
                {"label": f.get("wanzaiGov", "万载县人民政府"), "href": "http://www.wanzai.gov.cn/"},
                {"label": "作者个人主页", "href": "https://nathanpenny.fun"},
            ],
            "copyright": f.get("copyright", ""),
            "icpLines": [f["icp"]] if f.get("icp") else [],
            "beianHref": "https://beian.miit.gov.cn/",
        },
    }

    # ---------------- 首页 ----------------
    home = zh["home"]
    home_imgs = [("nuowu.jpeg", "/heritage/", home["culture"]), ("liudawan.jpeg", "/cuisine/", home["food"]), ("longhu_yanhuowanhui.jpeg", "/industry/", home["industry"])]
    index = {
        "hero": home["hero"],
        "carousel": [
            {"img": f, "alt": alt, "ar": img_ar(f)}
            for f, alt in (("yzxf_bswz.jpeg", "一朝相逢，便是万载"), ("guchen_xuejing.png", "万载古城"), ("sanshiba_pool.jpeg", "三十把水库"), ("xianyuanyanxue.jpg", "万载仙源研学"))
        ],
        "featuresTitle": home["features"]["title"],
        "features": [
            {"title": home["features"]["fireworks"]["title"], "desc": home["features"]["fireworks"]["desc"]},
            {"title": home["features"]["food"]["title"], "desc": home["features"]["food"]["desc"]},
            {"title": home["features"]["tourism"]["title"], "desc": home["features"]["tourism"]["desc"]},
        ],
        "sections": [
            {"title": c["title"], "desc": c["desc"], "learnMore": c["learnMore"], "href": href, "img": f, "ar": img_ar(f)}
            for f, href, c in home_imgs
        ],
        "cta": home["cta"],
    }

    # ---------------- 非遗文化（视频板块） ----------------
    c = zh["culture"]
    heritage = {
        "hero": {**c["hero"], "img": "nuowu.jpeg"},
        "videoHint": common["videoHint"],
        "sections": [
            {
                "key": key,
                "title": c["sections"][key]["title"],
                "paras": paras(c["sections"][key].get("desc1"), c["sections"][key].get("desc2"), c["sections"][key].get("desc3")),
                "video": VIDEO_BV[key],
            }
            for key in HERITAGE_ORDER
        ],
        "cta": {**c["cta"], "btn": common["viewRoutes"], "href": "/tourism/"},
    }

    # ---------------- 美食特产（三大组） ----------------
    fd = zh["food"]
    cuisine = {
        "hero": {**fd["hero"], "img": "liudawan.jpeg"},
        "groups": [
            {"title": fd["sections"]["liuDaWan"]["title"], "dishes": [
                dish(fd, k) for k in ("fuGuiYouJuan", "wanzaiZhaRou", "wanzaiZhaRou2", "wanzaiKuaiYu", "kangLeSanHuangJi", "qingDunHeiShanYang")
            ]},
            {"title": fd["sections"]["otherFood"]["title"], "dishes": [
                dish(fd, k) for k in ("luoChenZhaFen", "wanzaiDuoRou", "wanzaiFanYa")
            ]},
            {"title": fd["sections"]["traditionalSpecialties"]["title"], "dishes": [
                dish(fd, k) for k in ("wanzaiBaiHe", "biaoXinZhi", "nanSuanZaoGao")
            ]},
        ],
        "cta": {**fd["cta"], "btn": fd["cta"].get("cta", common["viewRoutes"]), "href": "/tourism/"},
    }

    # ---------------- 烟花产业 ----------------
    ind = zh["industry"]["sections"]
    industry = {
        "hero": {**zh["industry"]["hero"], "img": "longhu_yanhuowanhui.jpeg"},
        "history": {
            "title": ind["history"]["title"],
            "paras": paras(ind["history"].get("desc1"), ind["history"].get("desc2")),
            "video": INDUSTRY_VIDEO,
        },
        "status": {
            "title": ind["currentStatus"]["title"],
            "blocks": [
                {"title": ind["currentStatus"]["scale"], "paras": paras(ind["currentStatus"].get("scaleDesc1"), ind["currentStatus"].get("scaleDesc2"))},
                {"title": ind["currentStatus"]["market"], "paras": paras(ind["currentStatus"].get("marketDesc1"), ind["currentStatus"].get("marketDesc2"))},
                {"title": ind["techUpgrade"]["title"], "paras": paras(ind["techUpgrade"].get("desc1"), ind["techUpgrade"].get("desc2"), ind["techUpgrade"].get("desc3"))},
            ],
        },
        "cultureTourism": {"title": ind["cultureTourism"]["title"], "paras": paras(ind["cultureTourism"].get("desc1"), ind["cultureTourism"].get("desc2"), ind["cultureTourism"].get("desc3")), "img": "guchen_yanhua.jpeg", "ar": img_ar("guchen_yanhua.jpeg")},
        "future": {"title": ind["future"]["title"], "paras": paras(ind["future"].get("desc1"), ind["future"].get("desc2")), "img": "huapao_future.jpeg", "ar": img_ar("huapao_future.jpeg")},
        "cta": {**zh["industry"]["cta"], "btn": zh["industry"]["cta"].get("cta", common["viewRoutes"]), "href": "/spots/"},
    }

    # ---------------- 旅游线路（locations.ts travelRoutes） ----------------
    rt = zh["routes"]
    tourism = {
        "hero": {**rt["hero"], "img": "wanzai_travelling.jpeg"},
        "routesTitle": "行程安排",
        "routes": travel_routes_from_ts(),
    }

    # ---------------- 赏烟地点 ----------------
    vs = zh["viewingSpots"]
    s = vs["spots"]
    spots = {
        "hero": {**vs["hero"], "img": "viewingspots_hero.jpeg"},
        "viewingLabel": s["bestViewing"],
        "transportLabel": s["transportation"],
        "spots": [
            {"name": s["ancientCity"], "desc": s["ancientCityDesc1"], "viewing": s["ancientCityViewing"], "transport": s["ancientCityTransport"], "img": "guchen_niaokan.jpeg", "ar": img_ar("guchen_niaokan.jpeg")},
            {"name": s["longhuPark"], "desc": s["longhuParkDesc1"], "viewing": s["longhuParkViewing"], "transport": s["longhuParkTransport"], "img": "longhu_niaokan.jpeg", "ar": img_ar("longhu_niaokan.jpeg")},
        ],
        "tipsTitle": vs["tips"]["title"],
        "tips": [
            {"title": vs["tips"]["bestTime"], "items": [vs["tips"][f"time{i}"] for i in range(1, 6)]},
            {"title": vs["tips"]["notice"], "items": [vs["tips"][f"notice{i}"] for i in range(1, 6)]},
        ],
    }

    # ---------------- 关于 ----------------
    ab = zh["about"]["sections"]
    contact = ab["contact"]
    about = {
        "hero": {**zh["about"]["hero"], "img": "student-team.jpg"},
        "team": {
            "title": ab["team"]["title"],
            "members": [
                {"name": ab["team"]["members"][f"member{i}"]["name"], "role": ab["team"]["members"][f"member{i}"]["role"], "description": ab["team"]["members"][f"member{i}"]["description"]}
                for i in range(1, 7)
            ],
        },
        "background": ab["background"],
        "mission": ab["mission"],
        "timeline": {
            "title": ab["timeline"]["title"],
            "events": [
                {"date": ab["timeline"]["events"][f"event{i}"]["date"], "title": ab["timeline"]["events"][f"event{i}"]["title"], "description": ab["timeline"]["events"][f"event{i}"]["description"]}
                for i in range(1, 5)
            ],
        },
        "partners": {
            "title": ab["partners"]["title"],
            "list": [
                {"name": ab["partners"]["list"]["partner1"]["name"], "href": ""},
                {"name": ab["partners"]["list"]["partner2"]["name"], "href": "http://zgwzgc.com/"},
                {"name": ab["partners"]["list"]["partner3"]["name"], "href": "https://wwbnn.lanzouu.com/i5Esy3j90hcb"},
                {"name": ab["partners"]["list"]["partner4"]["name"], "href": "http://www.wztlhp.com/"},
            ],
        },
        "contact": {
            "title": contact["title"],
            # 二维码类（大图展示）
            "qrs": [
                {"label": contact["wechatLabel"], "value": contact["wechat"], "qr": "wxofficial.jpg"},
                {"label": contact["videoLabel"], "value": contact["video"], "qr": "videoaccount.jpeg"},
            ],
            # 链接类（列表行）
            "links": [
                {"label": contact["emailLabel"], "value": site["email"], "href": f"mailto:{site['email']}"},
                {"label": contact["douyinLabel"], "value": contact["douyin"], "href": DOUYIN_OFFICIAL},
                {"label": contact["serviceLabel"], "value": contact["service"], "href": WEIXIN_SERVICE},
                {"label": contact["xiaohongshuLabel"], "value": contact["xiaohongshu"], "href": XIAOHONGSHU},
            ],
        },
    }

    out_files = {
        "site.json": site, "index.json": index, "heritage.json": heritage,
        "cuisine.json": cuisine, "industry.json": industry,
        "tourism.json": tourism, "spots.json": spots, "about.json": about,
    }
    for name, data in out_files.items():
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
