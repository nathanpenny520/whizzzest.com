#!/usr/bin/env python3
"""One-off content extractor: 旧站 zh-CN.json → 新站 src/data/*.json

来源: reference/old-site/packages/frontend/src/locales/zh-CN.json
产物: src/data/site.json + 每页一个数据文件（字段结构见各文件）
图片映射: 下方 IMG_MAP，key 按子串匹配旧资产文件名。
"""
import json
import os

SRC = "reference/old-site/packages/frontend/src/locales/zh-CN.json"
OUT = "src/data"

# 旧板块 key → 新站图片文件名（子串匹配，按声明顺序取首个命中）
IMG_RULES = [
    (("fireworks", "huapaoqing"), "wanzaihuapao.jpg"),
    (("desheng",), "deshengu.jpg"),
    (("kaikou", "nuo"), "kaikounuo.jpeg"),
    (("zhipeng",), "zhipengshange.jpg"),
    (("xiabu",), "xiabu.png"),
    (("nuowu", "nuo Dance"), "nuowu.jpeg"),
    (("liudawan", "liuDaWan"), "liudawan.jpeg"),
    (("fugui",), "fuguiyoujuan.jpeg"),
    (("zharou2", "zha4"), "wanzaizha4rou.jpeg"),
    (("zharonew", "zharou1", "zha1", "wanzaiZhaRou"), "wanzaizha1rou.jpeg"),
    (("kuaiyu",), "wanzaikuaiyu.jpeg"),
    (("kangle", "sanhuang"), "kanglesanhuangji.jpeg"),
    (("qingdun", "heishan"), "qingdunheishanyang.jpeg"),
    (("zhafen",), "luochenzhafen.jpeg"),
    (("duorou",), "wanzaiduorou.jpeg"),
    (("fanya",), "wanzaifanya.jpeg"),
    (("baihe",), "baiheshenkai.jpeg"),
    (("biaoxin",), "biaoxingzhi.jpeg"),
    (("suanzao",), "nansuanzaogao.jpeg"),
    (("history",), "wanzaihuapao.jpg"),
    (("currentstatus",), "tailin-gongchang.jpg"),
    (("tech",), "huapao_future.jpeg"),
    (("culturetourism",), "longhu_yanhuowanhui.jpeg"),
    (("future",), "moonuniverse.jpeg"),
    (("ancientcity",), "guchen_yanhua.jpeg"),
    (("longhupark",), "longhu_yanhuowanhui.jpeg"),
]


def img_for(key: str) -> str:
    k = key.lower()
    for needles, img in IMG_RULES:
        if any(n.lower() in k for n in needles):
            return img
    return ""


def dict_to_items(d, with_img=True):
    """{key: {title, desc, ...}} → [{key, title, desc..., paras[], img}]，保持声明顺序

    paras = 旧字段 desc/desc1/desc2/desc3 统一合并为段落数组，模板只需 {{#each paras}}。
    """
    items = []
    for key, v in d.items():
        if isinstance(v, str):
            continue  # 纯字符串键留给专用处理
        item = {"key": key, **v}
        item["paras"] = [item[f] for f in ("desc", "desc1", "desc2", "desc3") if item.get(f)]
        if with_img and "img" not in item:
            item["img"] = img_for(key)
        items.append(item)
    return items


def main():
    zh = json.load(open(SRC, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)

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
                {"label": f.get("chinaFireworks", "中国烟花爆竹协会"), "href": "https://www.chinafireworks.org.cn/"},
                {"label": "万载发布 · 抖音", "href": "https://www.douyin.com/user/MS4wLjABAAAA0fPcuNv5vy46rDu3W1laQUVvZQiyr9MbDl7E60WUnrOKVkG_JKKy68tZiWA_L3A8"},
            ],
            "copyright": f.get("copyright", ""),
            "icpLines": [f["icp"]] if f.get("icp") else [],
            "beianHref": "https://beian.miit.gov.cn/",
        },
    }

    home = {
        "hero": zh["home"]["hero"],
        "featuresTitle": zh["home"]["features"]["title"],
        "features": [
            {**zh["home"]["features"]["fireworks"], "img": "wanzaihuapao.jpg", "href": "/industry/"},
            {**zh["home"]["features"]["food"], "img": "liudawan.jpeg", "href": "/cuisine/"},
            {**zh["home"]["features"]["tourism"], "img": "guchen_xuejing.png", "href": "/tourism/"},
        ],
        "teasers": [
            {"title": "非遗文化", "desc": "花炮、得胜鼓、开口傩、夏布织造——探秘国家级非物质文化遗产。", "img": "nuowu.jpeg", "href": "/heritage/"},
            {"title": "美食特产", "desc": "六大碗、百合、扎粉……赣西山水的馈赠，舌尖上的万载。", "img": "guchen_yanhua.jpeg", "href": "/cuisine/"},
            {"title": "烟花产业", "desc": "中国四大花炮主产区之一，1400 年窑火不熄。", "img": "huapao_future.jpeg", "href": "/industry/"},
        ],
        "cta": zh["home"]["cta"],
    }

    def page(src_key, out_key):
        src = zh[src_key]
        data = {"hero": src["hero"], "cta": src.get("cta")}
        if "sections" in src:
            data["sections"] = dict_to_items(src["sections"])
        return data

    heritage = page("culture", "heritage")
    cuisine_src = dict(zh["food"]["sections"])
    # otherFood / special / traditionalSpecialties 为汇总性条目，不适合做菜品卡片，剔除
    for k in ("otherFood", "special", "traditionalSpecialties"):
        cuisine_src.pop(k, None)
    cuisine_sections = dict_to_items(cuisine_src)
    # 第一道（六大碗）作为大图特写，其余进卡片网格
    cuisine = {"hero": zh["food"]["hero"], "cta": zh["food"].get("cta"),
               "featured": cuisine_sections[0] if cuisine_sections else None,
               "dishes": cuisine_sections[1:]}
    industry = page("industry", "industry")

    r = zh["routes"]["routes"]
    tourism = {"hero": zh["routes"]["hero"], "cta": zh["routes"].get("cta"),
               "routes": [
                   {"key": "ancient", "title": r["ancient"], "img": "guc_wenhua_tra.jpg",
                    "schedule": [{"time": "上午", "desc": r["ancientMorning"]}, {"time": "中午", "desc": r["ancientNoon"]}, {"time": "下午", "desc": r["ancientAfternoon"]}, {"time": "晚上", "desc": r["ancientEvening"]}]},
                   {"key": "mountain", "title": r["mountain"], "img": "sanshiba_pool.jpeg",
                    "schedule": [{"time": "上午", "desc": r["mountainMorning"]}, {"time": "中午", "desc": r["mountainNoon"]}, {"time": "下午", "desc": r["mountainAfternoon"]}, {"time": "晚上", "desc": r["mountainEvening"]}]},
                   {"key": "red", "title": r["red"], "img": "hongs_wenhua_tra.jpg",
                    "schedule": [{"time": "上午", "desc": r["redMorning"]}, {"time": "中午", "desc": r["redNoon"]}, {"time": "下午", "desc": r["redAfternoon"]}, {"time": "晚上", "desc": r["redEvening"]}]},
               ],
               "gallery": [
                   {"img": "guchen_niaokan.jpeg", "alt": "万载古城鸟瞰"},
                   {"img": "guchen_xuejing.png", "alt": "古城雪景"},
                   {"img": "sanshiba_pool.jpeg", "alt": "三十把水库"},
                   {"img": "xianyuanyanxue.jpg", "alt": "仙源红色研学"},
                   {"img": "mountains.jpeg", "alt": "九龙原始森林"},
                   {"img": "longhu_yanhuowanhui.jpeg", "alt": "龙湖烟花晚会"},
               ]}

    s = zh["viewingSpots"]["spots"]
    spots = {"hero": zh["viewingSpots"]["hero"], "cta": zh["viewingSpots"].get("cta"),
             "spots": [
                 {"key": "ancientCity", "name": s["ancientCity"], "desc": s["ancientCityDesc1"],
                  "viewing": s["ancientCityViewing"], "transport": s["ancientCityTransport"], "img": "guchen_yanhua.jpeg"},
                 {"key": "longhuPark", "name": s["longhuPark"], "desc": s["longhuParkDesc1"],
                  "viewing": s["longhuParkViewing"], "transport": s["longhuParkTransport"], "img": "longhu_yanhuowanhui.jpeg"},
             ],
             "bestViewing": s.get("bestViewing", ""), "transportation": s.get("transportation", "")}

    about = {
        "title": f.get("about", "关于焰境·万载"),
        "desc": f.get("aboutDesc", ""),
        "contact": f.get("contact", "联系我们"),
        "email": "whizzzest@outlook.com",
        "codes": [
            {"name": "万载人民政府", "img": "wanzai_gov_QR.jpg"},
            {"name": "万载文旅", "img": "wanzai_wenlv_QR.jpg"},
            {"name": "焰境·万载", "img": "wxofficial.jpg"},
        ],
        "links": [
            {"label": "GitHub", "href": "https://github.com/nathanpenny520/WhizzZest.git"},
            {"label": "Gitee", "href": "https://gitee.com/nathanpenny520/WhizzZest.git"},
            {"label": "抖音", "href": "https://www.douyin.com/user/MS4wLjABAAAAhy0jc-hMIansK5QmD-5fikKmvNrSA2qUn9qmDNFTsqOoVZX0TJa4VoLiNU-bBP_f"},
        ],
        "gallery": [
            {"img": "site_intro_1.jpg", "alt": "焰境·万载 团队掠影 1"},
            {"img": "site_intro_2.jpg", "alt": "焰境·万载 团队掠影 2"},
            {"img": "site_intro_3.jpg", "alt": "焰境·万载 团队掠影 3"},
        ],
    }

    out_files = {
        "site.json": site, "index.json": home, "heritage.json": heritage,
        "cuisine.json": cuisine, "industry.json": industry,
        "tourism.json": tourism, "spots.json": spots, "about.json": about,
    }
    for name, data in out_files.items():
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        print(f"wrote {name}")

    # 报告未匹配到图片的条目，便于人工补映射
    for name in ("heritage", "cuisine", "industry"):
        for item in out_files[f"{name}.json"].get("sections", []):
            if not item.get("img"):
                print(f"!! {name} section without img: {item['key']}")


if __name__ == "__main__":
    main()
