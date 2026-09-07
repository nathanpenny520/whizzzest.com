-- 商户种子数据：万载本地商户（美食/住宿/特产/花炮/其他）
-- 生成时间：2026-09-07（v2 事实校订版）
-- 数据来源：携程、Trip.com、企查查、万载县政府公开信息及本地生活平台
-- 时效性说明：人均消费、评分、营业时间等来自 OTA 平台公开信息，可能随时间变化，
--   建议站长上线前与商户核实确认；联系电话部分为公开号码，部分留空待商户入驻时补充。
-- 电话号码来源说明（仅以下4个有公开可查来源，其余均为 NULL 待补充）：
--   大斌家串串火锅 19907955273（Trip.com）
--   万载山水迎宾馆 0795-8829999（携程）
--   宜嘉酒店 0795-8888777（携程）
--   金峰花炮 0795-8903623（企查查/买购网）
-- 事实口径：龙牙百合种植历史 = 500多年（新华网/中新网/农业农村部公示口径）
-- tier 统一 'free'、paid_until 统一 NULL（= 永久展示）；真实认证/付费后由站长后台再调
-- INSERT OR IGNORE：slug 唯一键冲突时跳过，可安全重复执行
-- 注意：cover/images 留空，站长可在后台上传封面图与图集

-- ============================================================
-- 美食类（food）
-- ============================================================

-- 1. 万载家宴（古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-wanzai-jiayan',
  '万载家宴（古城店）',
  'food',
  'free',
  '古城里的万载本土菜馆，六大碗与罗城扎粉是招牌，人均46元。',
  '位于万载古城5栋102号附9号，主打正宗万载本土菜系。招牌菜包括百合肉丸汤、家宴当家肉、炒罗城扎粉、红烧肉、干煸肥肠、黑腐竹、老豆腐等，兼具万载宴席的庄重与家常小炒的烟火气。

店内环境古色古香，与古城赣派建筑风格融为一体，适合家庭聚餐、朋友小酌和游客体验本地风味。人均消费约46元，性价比突出，是古城内口碑较好的万载菜餐厅之一。',
  NULL, NULL,
  '万载古城5栋102号附9号',
  NULL,
  NULL,
  '10:00–21:30',
  NULL, NULL,
  'approved',
  NULL,
  10,
  datetime('now'), datetime('now')
);

-- 2. 乡村第一餐（万载店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-xiangcun-diyican',
  '乡村第一餐（万载店）',
  'food',
  'free',
  '龙河星城对面的湘赣风味菜馆，评分4.8，人均58元，地道乡村口味。',
  '位于康乐街道沿河西路51号（龙河星城对面），主打湘菜与赣菜融合的乡村风味。食材多取自本地农户，菜品分量足、味道重，深受本地食客喜爱。

招牌菜包括万载剁肉、乡村土鸡、小炒黄牛肉、时令野菜等。店内环境宽敞，设有包间，适合家庭聚会和商务便餐。人均消费约58元，在万载餐饮中属于中等偏上价位。',
  NULL, NULL,
  '康乐街道沿河西路51号（龙河星城对面）',
  NULL,
  NULL,
  '09:30–21:00',
  NULL, NULL,
  'approved',
  NULL,
  8,
  datetime('now'), datetime('now')
);

-- 3. 万载厨房（古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-wanzai-chufang',
  '万载厨房（古城店）',
  'food',
  'free',
  '古城田下街区的江西菜馆，评分4.7，人均51元，主打万载家常味。',
  '位于万载古城田下街区4栋1楼218，是一家以江西菜和万载本地风味为主的餐厅。店内装修简约温馨，菜品价格亲民。

推荐菜品包括万载扎肉、块鱼、三黄鸡清炖、炒扎粉等万载经典菜肴，也提供各类时令小炒。适合游客在游览古城后就近用餐，体验地道的万载味道。',
  NULL, NULL,
  '万载古城田下街区4栋1楼218',
  NULL,
  NULL,
  '10:00–21:00',
  NULL, NULL,
  'approved',
  NULL,
  5,
  datetime('now'), datetime('now')
);

-- 4. 原味剁肉馆
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-yuanwei-duorou',
  '原味剁肉馆',
  'food',
  'free',
  '古城南门小吃街的万载剁肉专门店，现宰黑猪肉手工剁制，鲜辣下饭。',
  '位于古城田下南门小吃街区R东9栋101号，是一家以万载剁肉为招牌的特色小馆。万载剁肉选用本地现宰黑猪肉前槽部位，手工剁制入味，肥瘦比例恰到好处，经热油煸炒搭配本地鲜椒、蒜苗爆炒，色泽红亮、鲜嫩多汁。

除剁肉外，还提供万载扎粉、番鸭、时令蔬菜等本地家常菜。店面不大但人气旺盛，是古城小吃街里的热门摊位，适合快速品尝万载地道风味。',
  NULL, NULL,
  '古城田下南门小吃街区R东9栋101号',
  NULL,
  NULL,
  '10:30–20:30',
  NULL, NULL,
  'approved',
  NULL,
  3,
  datetime('now'), datetime('now')
);

-- 5. 茗竹楼（龙河星城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-mingzhulou',
  '茗竹楼（龙河星城店）',
  'food',
  'free',
  '沿河西路的中式茶楼餐厅，环境优雅，菜品丰富，适合商务宴请与休闲小聚。',
  '位于沿河西路59号（龙河星城附近），是一家集茶饮与中餐于一体的中式餐厅。店内环境优雅，以竹文化为装饰主题，闹中取静。

菜品涵盖赣菜、湘菜及粤式茶点，提供包厢服务，适合商务宴请、朋友聚会和家庭聚餐。茶位费亲民，下午茶时段有各式点心和功夫茶可供选择。',
  NULL, NULL,
  '沿河西路59号',
  NULL,
  NULL,
  '09:00–22:00',
  NULL, NULL,
  'approved',
  NULL,
  4,
  datetime('now'), datetime('now')
);

-- 6. 大斌家串串火锅（万载店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-dabinjia-chuanchuan',
  '大斌家串串火锅（万载店）',
  'food',
  'free',
  '庙街101号的串串火锅连锁店，营业至凌晨2点，评分4.5，年轻人聚餐热门地。',
  '位于庙街101号，是全国连锁串串火锅品牌大斌家在万载的分店。店内提供数十种串串食材，自选自取，锅底有麻辣、清汤、鸳鸯等多种选择。

环境时尚年轻化，支持手机支付和刷卡，提供免费Wi-Fi和充电服务。营业时间从上午10点持续到次日凌晨2点，是万载少有的深夜餐饮选择，深受年轻食客喜爱。',
  NULL, NULL,
  '庙街101号',
  '19907955273',
  NULL,
  '10:00–次日02:00',
  NULL, NULL,
  'approved',
  NULL,
  2,
  datetime('now'), datetime('now')
);

-- 7. 汐岸融合餐厅
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-xian-ronghe',
  '汐岸融合餐厅',
  'food',
  'free',
  '金街三栋一楼的平价西餐厅，黑椒西冷牛排与肥牛乌冬面是招牌，氛围感十足。',
  '位于金街三栋一楼，是一家主打西式融合料理的休闲餐厅。店内装修精致，氛围感强，适合情侣约会和朋友小聚。

招牌菜品包括黑椒西冷牛排（原切牛肉）、鲜炸薯条、肥牛乌冬面等，搭配特调饮品如香水茉莉、红果落日等。价格亲民，牛排套餐低至49元，是万载少有的高性价比西餐选择。',
  NULL, NULL,
  '金街三栋一楼',
  NULL,
  NULL,
  '10:30–22:00',
  NULL, NULL,
  'approved',
  NULL,
  1,
  datetime('now'), datetime('now')
);

-- ============================================================
-- 住宿类（stay）
-- ============================================================

-- 8. 丽枫酒店（万载古城景区店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-lifeng-hotel',
  '丽枫酒店（万载古城景区店）',
  'stay',
  'free',
  '古城金街C4栋的舒适型酒店，评分4.6，房间正对古城夜景，周末可看烟花。',
  '位于万载古城金街C4栋201号，是锦江酒店集团旗下丽枫品牌在万载的分店。酒店地理位置优越，紧邻万载古城景区，部分房间可直接观赏古城夜景和周末烟花表演。

酒店设施完善，提供免费停车场、影音房、自助早餐等服务。房间干净整洁，床品松软舒适，前台服务热情。周边餐饮购物便利，是来万载旅游住宿的热门选择，在万载古城舒适型酒店中排名靠前。',
  NULL, NULL,
  '万载古城金街C4栋201号',
  NULL,
  NULL,
  '24小时前台',
  NULL, NULL,
  'approved',
  NULL,
  20,
  datetime('now'), datetime('now')
);

-- 9. 万载山水迎宾馆（古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-shanshui-yingbin',
  '万载山水迎宾馆（古城店）',
  'stay',
  'free',
  '坐落于万载古城内的星级标准度假酒店，83间客房，建筑面积约5000平方米。',
  '位于万载田下古城内，是一家以星级标准打造装修的旅游度假酒店。酒店建筑面积约5000平方米，地处万载中心，坐落于万载古城景区内，出门即达古城各景点。

酒店拥有83间客房，提供自助早餐、免费停车场和套房服务。2019年开业，环境清幽，古色古香，与古城风貌融为一体。适合希望深度体验古城文化的游客入住，步行即可游览祠堂群、品尝古城美食。',
  NULL, NULL,
  '万载田下古城',
  '0795-8829999',
  NULL,
  '24小时前台',
  NULL, NULL,
  'approved',
  NULL,
  15,
  datetime('now'), datetime('now')
);

-- 10. 宜春万载宜嘉酒店（古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-yijia-hotel',
  '宜春万载宜嘉酒店（古城店）',
  'stay',
  'free',
  '宝塔东路88号的高档酒店，103间客房，以星级标准打造，2021年全新装修。',
  '位于万载县宝塔东路88号，是万载县以星级标准打造的高档酒店。酒店2019年开业，2021年全新装修，拥有103间客房。

酒店设施齐全，房间宽敞明亮，提供免费停车场、自助早餐、洗衣房等服务。地理位置优越，距万载古城和汽车站均在短途车程内，周边商业配套完善。适合商务出行和家庭旅游入住。',
  NULL, NULL,
  '宝塔东路88号',
  '0795-8888777',
  NULL,
  '24小时前台',
  NULL, NULL,
  'approved',
  NULL,
  12,
  datetime('now'), datetime('now')
);

-- 11. 半岛酒店（宜春万载古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-bandao-hotel',
  '半岛酒店（宜春万载古城店）',
  'stay',
  'free',
  '阳乐大道189号的商务酒店，隔音好、房间大，早餐种类丰富，出行便利。',
  '位于万载县阳乐大道189号，是一家商务型酒店。酒店房间宽敞、采光好，床品舒适，卫生间干湿分离，洗护用品品质较好。

早餐种类丰富，提供现煮面条和粥品，餐厅服务热情。地理位置优越，出门即有公交站，周边餐饮购物配套齐全，距万载古城约5分钟车程。适合商务出行和短途旅游入住。',
  NULL, NULL,
  '阳乐大道189号',
  NULL,
  NULL,
  '24小时前台',
  NULL, NULL,
  'approved',
  NULL,
  6,
  datetime('now'), datetime('now')
);

-- 12. 嘉华大酒店（宜春万载古城康乐大道店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-jiahua-hotel',
  '嘉华大酒店（万载古城康乐大道店）',
  'stay',
  'free',
  '汇丰大厦康乐大道的舒适型酒店，提供管家服务、免费停车场和洗衣房，早餐丰富。',
  '位于万载县康乐大道汇丰大厦，是一家舒适型商务酒店。酒店提供管家服务、免费停车场、洗衣房和自助早餐，住客评价早餐丰富、住宿舒适。

地理位置优越，紧邻万载古城，周边商业配套完善，出行便利。适合商务出行和来万载旅游的游客入住。',
  NULL, NULL,
  '康乐大道汇丰大厦',
  NULL,
  NULL,
  '24小时前台',
  NULL, NULL,
  'approved',
  NULL,
  5,
  datetime('now'), datetime('now')
);

-- 13. 叁朵酒店（万载古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-sanduo-hotel',
  '叁朵酒店（万载古城店）',
  'stay',
  'free',
  '近万载古城的精品设计酒店，评分4.7，装修有格调，性价比高。',
  '位于万载古城附近，是一家精品设计型酒店。酒店装修有格调，卫生干净整洁，住客评价舒适安心。

提供免费停车场，距古城步行可达，周边餐饮购物便利。价格亲民，是万载古城周边性价比颇高的住宿选择，适合年轻游客和预算有限的旅行者。',
  NULL, NULL,
  '万载县康乐街道（近古城景区）',
  NULL,
  NULL,
  '24小时前台',
  NULL, NULL,
  'approved',
  NULL,
  3,
  datetime('now'), datetime('now')
);

-- ============================================================
-- 特产类（specialty）
-- ============================================================

-- 14. 龙牙百合特产店（古城店）
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-longya-baihe-shop',
  '龙牙百合特产店（古城店）',
  'specialty',
  'free',
  '万载古城内的龙牙百合专营特产店，五百多年种植历史的白水龙牙百合，药食同源。',
  '位于万载古城景区内，专营万载龙牙百合系列产品。万载龙牙百合已有五百多年种植历史，以白水乡所产最为著名，三年一收，肉质厚实、自然甘甜、细腻清香，被誉为百合中的上品。

店内主营龙牙百合粉、鲜百合、百合干、百合面等系列产品。百合粉温润护胃，保留百合多糖与黏液蛋白，是万载最具代表性的伴手礼之一。所有产品均通过绿色食品认证，不漂白、不添加。支持礼盒包装，适合馈赠亲友。',
  NULL, NULL,
  '万载古城景区内',
  NULL,
  NULL,
  '09:00–21:00',
  NULL, NULL,
  'approved',
  NULL,
  10,
  datetime('now'), datetime('now')
);

-- 15. 绿之谣龙牙百合
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-lvzhiyao-baihe',
  '绿之谣龙牙百合',
  'specialty',
  'free',
  '万载本地龙牙百合品牌，自有200亩百合基地，线上线下热销，鲜百合与百合粉为主打。',
  '绿之谣是万载本地龙牙百合品牌，自有200亩百合基地并与农户合作种植，全程不漂白、不添加，通过绿色食品认证。

主营鲜百合、龙牙百合粉、百合干等产品。鲜百合每年秋季上市，肉质肥厚、口感清甜；百合粉经传统工艺与现代科技结合提取，温润护胃，保留百合多糖与营养成分。产品线上电商平台热销，发货覆盖全国，是万载百合产业化的代表品牌之一。',
  NULL, NULL,
  '万载县白水乡（基地）/ 县城设展销点',
  NULL,
  NULL,
  '08:30–18:00',
  NULL, NULL,
  'approved',
  NULL,
  6,
  datetime('now'), datetime('now')
);

-- 16. 千年食品万载特产
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-qiannian-specialty',
  '千年食品万载特产',
  'specialty',
  'free',
  '以有机绿色原料传承万载特产本味，南酸枣糕与百合系列产品是招牌，老少皆宜。',
  '千年食品是万载本地特产食品品牌，以有机绿色原料传承地方特产本味。主营产品包括万载南酸枣糕、龙牙百合粉、百合面、罗城扎粉等万载特色食品。

南酸枣糕以万载深山野生南酸枣为原料，无添加色素与食用胶，经传统熬制与现代低温工艺制作，糕体呈琥珀色，柔韧不粘牙，酸中带甜且果香浓郁，富含植物黄酮与天然果胶，是老少皆宜的天然健康伴手礼。产品包装精美，适合作为旅游纪念品和节日礼品。',
  NULL, NULL,
  '万载县工业园',
  NULL,
  NULL,
  '08:00–17:30',
  NULL, NULL,
  'approved',
  NULL,
  5,
  datetime('now'), datetime('now')
);

-- 17. 山货铺子万载特产
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-shanhuo-puzi',
  '山货铺子万载特产',
  'specialty',
  'free',
  '长年供应万载本地山货特产，龙牙百合粉、南酸枣糕、手工小吃一应俱全。',
  '山货铺子是一家供应万载本地山货特产的店铺，产品涵盖龙牙百合粉、南酸枣糕、酸枣粒、麦酱、手工小吃、豆豉姜、苦瓜干、醋姜、辣椒干、南瓜干、豆腐乳等万载传统农副食品。

所有产品均取自万载本地山区农户，坚持传统手工制作，无过多添加。店铺主打「大自然的搬运工」理念，让顾客回味童年的味道。适合购买地道的万载农家土特产，支持散装和礼盒装。',
  NULL, NULL,
  '万载县康乐街道',
  NULL,
  NULL,
  '08:00–20:00',
  NULL, NULL,
  'approved',
  NULL,
  3,
  datetime('now'), datetime('now')
);

-- ============================================================
-- 花炮类（fireworks）
-- ============================================================

-- 18. 江西省万载县金峰花炮有限公司
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-jinfeng-fireworks',
  '江西省万载县金峰花炮有限公司',
  'fireworks',
  'free',
  '1998年成立的万载老牌花炮企业，注册资本1000万元，拥有进出口资质，产品远销海外。',
  '江西省万载县金峰花炮有限公司成立于1998年11月，注册资本1000万元，是万载县老牌花炮生产企业。公司位于万载县城金三角金峰楼，拥有进出口资质，产品远销欧美及东南亚等国家和地区。

公司集花炮科研、生产、销售于一体，拥有多项专利技术，是科技型中小企业和省级创新型中小企业。主要生产组合烟花、爆竹类、喷花类等产品，以品质优良、安全环保著称。公司通过安全生产标准化认证，是万载花炮产业转型升级的代表性企业之一。',
  NULL, NULL,
  '万载县城金三角金峰楼',
  '0795-8903623',
  NULL,
  '08:00–17:30（工作日）',
  NULL, NULL,
  'approved',
  NULL,
  15,
  datetime('now'), datetime('now')
);

-- 19. 万载县金顺出口烟花制造有限公司
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-jinshun-fireworks',
  '万载县金顺出口烟花制造有限公司',
  'fireworks',
  'free',
  '科技型中小企业，主营烟花爆竹生产和批发，2025年获评市级安全生产标准化三级企业。',
  '万载县金顺出口烟花制造有限公司是一家集烟花爆竹生产和批发于一体的企业，为科技型中小企业。公司2025年获评市级安全生产标准化三级企业，严格按照新国标GB10631-2025组织生产。

公司产品涵盖组合烟花、爆竹、喷花等多个品类，以出口和内销并重。在万载花炮产业政策引导下，积极推进安全与绿色转型，推行企业内部隐患报告奖励制度，是万载花炮产业规范化发展的代表企业之一。',
  NULL, NULL,
  '万载县花炮产业园区',
  NULL,
  NULL,
  '08:00–17:00（工作日）',
  NULL, NULL,
  'approved',
  NULL,
  8,
  datetime('now'), datetime('now')
);

-- 20. 万载县万景祥烟花鞭炮制造有限公司
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-wanjingxiang-fireworks',
  '万载县万景祥烟花鞭炮制造有限公司',
  'fireworks',
  'free',
  '2011年成立的花炮制造企业，注册资本380万元，主营烟花鞭炮生产销售。',
  '万载县万景祥烟花鞭炮制造有限公司成立于2011年3月，注册资本380万元，是万载县本土花炮生产企业。公司主要从事烟花鞭炮的制造与销售，产品面向国内节庆市场。

公司严格遵守烟花爆竹安全生产规范，在万载花炮产业集群中稳步经营。产品以组合烟花和爆竹类为主，适合春节、婚庆、开业等各类庆典场合使用，是万载本地花炮供应链中的重要一环。',
  NULL, NULL,
  '万载县花炮产业园区',
  NULL,
  NULL,
  '08:00–17:00（工作日）',
  NULL, NULL,
  'approved',
  NULL,
  4,
  datetime('now'), datetime('now')
);

-- ============================================================
-- 其他类（other）
-- ============================================================

-- 21. 古城夏布织造体验坊
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-xiabu-workshop',
  '古城夏布织造体验坊',
  'other',
  'free',
  '万载古城内的国家级非遗夏布织造体验店，1600年传统手艺可看可学可买。',
  '位于万载古城景区内，是一家以国家级非遗夏布织造技艺为核心的文化体验店。万载夏布历史悠久，有1600多年的传承，以本地苎麻为原料纯手工织造，唐朝时即为贡品，深受韩国、日本、东南亚客商喜爱。

体验坊内展示夏布织造的完整工艺流程，包括绩纱、浆纱、织布等环节，游客可近距离观看匠人操作，甚至亲身体验上机织布。店内同时销售夏布成品，包括夏布围巾、茶席、挂画、服饰等，是购买万载非遗文创产品的首选之地。',
  NULL, NULL,
  '万载古城景区内',
  NULL,
  NULL,
  '09:00–21:00',
  NULL, NULL,
  'approved',
  NULL,
  8,
  datetime('now'), datetime('now')
);

-- 22. 万载古城花灯工坊
INSERT OR IGNORE INTO merchants (slug, name, category, tier, intro, detail, cover, images, address, phone, wechat, hours, contact_name, contact_phone, status, paid_until, sort_weight, created_at, updated_at) VALUES (
  'm-huadeng-workshop',
  '万载古城花灯工坊',
  'other',
  'free',
  '省级非遗万载花灯传承体验店，手工花灯可定制可购买，节日氛围浓厚。',
  '位于万载古城景区内，是一家以省级非遗万载花灯为主题的手工工坊。万载花灯是万载传统民俗文化的重要组成部分，每逢元宵、中秋等传统节日，古城内张灯结彩，花灯巡游热闹非凡。

工坊内展示各类手工花灯，包括传统宫灯、生肖灯、花卉灯等，均由匠人手工扎制、彩绘。游客可参观花灯制作过程，也可参与DIY体验，亲手制作一盏属于自己的花灯。成品花灯可购买带回家，是极具万载特色的文化纪念品。',
  NULL, NULL,
  '万载古城景区内',
  NULL,
  NULL,
  '09:30–21:30',
  NULL, NULL,
  'approved',
  NULL,
  5,
  datetime('now'), datetime('now')
);
