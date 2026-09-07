-- 文库种子数据：万载本土短篇散文与随笔
-- 生成时间：2026-09-07（v2 事实校订版）
-- 内容：8篇原创短篇散文/随笔，主题覆盖万载古城、花炮、夏布、祠堂、扎粉、得胜鼓、百合、傩戏
-- 均为 admin 直建（writer_id=NULL），状态 approved，免审直发
-- 幂等设计：books 用 slug UNIQUE + INSERT OR IGNORE；chapters 用 NOT EXISTS 防重复
-- 事实口径说明：
--   龙牙百合种植历史 = 500多年（新华网/中新网/中国经济网/农业农村部公示口径）
--   万载古城古祠堂 = 27座、13姓氏（万载古城官网4A景区公告/中新网口径）
--   罗城扎粉 = 江西省级非遗（2010年第三批，编号Ⅷ-52）
--   万载花炮出口 = 全球100多个国家和地区（央广网/宜春发布口径）
-- 注意：cover 留空，站长可在后台上传封面图

-- ============================================================
-- 作品1：《古城夜话》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-gucheng-yehua',
  '古城夜话',
  'essay',
  '暮色四合时走进万载古城，祠堂的飞檐挑着一盏盏红灯笼，一千八百年的时光在青石板上缓缓流淌。',
  NULL,
  '田下客',
  NULL,
  'approved',
  10,
  1,
  720,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '古城夜话',
'暮色四合，华灯初上，踏入万载古城的那一刻，时间便慢了下来。

这座古称阳乐、康乐的城，自三国孙吴黄武年间置县，已走过近一千八百年。唐宋时这里水草丰茂，后人开垦为田，种下席草与水稻，所以古城还有一个朴素的名字——田下。

我沿着田下街区的青石板慢慢走。两侧是明清至民国时期的老建筑，白墙黛瓦，马头墙错落。最震撼的是祠堂群——二十七座古祠堂，涵盖郭、易、辛、彭、闻等十三个姓氏，据说是全国规模最大、保存最完整的多姓氏祠堂集群。郭氏宗祠始建于明天启七年，供奉的是唐代名将郭子仪的后裔；绿荫公祠重檐歇山顶，木雕灰塑精美绝伦，如今变身为祠堂文化馆。

小溪从城中穿过，往南是生活区，往西是祠堂区。老人们坐在门槛上摇蒲扇，孩子们追着跑过巷弄，大碗茶的清香从街角飘来。得胜鼓的铿锵声隐约响起，那是古城的艺人们在排练，鼓点再现古代将士凯旋的盛况。

走到古城中心，抬头看见文昌阁的飞檐挑着一轮圆月。周末的烟花在远处绽放，映红了半边天，也映红了祠堂的白墙。我忽然明白，为什么这里叫"焰境"——火与焰，不仅是花炮的光，更是这一千八百年不曾熄灭的人间烟火。

一朝相逢，便是万载。',
NULL, 'approved', 720, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-gucheng-yehua'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品2：《花炮之乡的童年》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-huapao-tongnian',
  '花炮之乡的童年',
  'essay',
  '在万载，几乎每个孩子的童年记忆里都有火药的硫磺香。那不是危险的味道，是年的味道、是喜庆的味道。',
  NULL,
  '田下客',
  NULL,
  'approved',
  9,
  1,
  680,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '花炮之乡的童年',
'万载人对花炮的感情，是刻在骨子里的。

这里是中国花炮之乡，与湖南浏阳、醴陵并称全国三大花炮主产区。小时候，县城周边的山坡上随处可见花炮厂的厂房，白墙灰瓦，墙上刷着红色的安全生产标语。大人们在厂里搓筒、装药、引线，我们这些孩子则在厂外的空地上玩摔炮、划炮。

最盼的是过年。腊月里，家家户户开始备年货，花炮是必不可少的。父亲会从花炮厂的门市部买回一挂万响的鞭炮、几盒冲天炮、还有给我玩的"大地花开"和"窜天猴"。年三十的晚上，吃完年夜饭，十二点整，全城的鞭炮声同时响起，震耳欲聋，硝烟弥漫，整个县城笼罩在一片火光与硫磺香之中。

那时候觉得，年的味道就是火药的味道。

后来去外地读书，才知道不是每个地方过年都放这么多鞭炮。也才知道，万载的花炮不仅供本地人过年，自上世纪六十年代敲开海外大门以来，如今已有十一大类近千个品种远销美洲、欧洲、东南亚等全球一百多个国家和地区。金峰、鑫达、猎鹰……这些家乡的花炮企业，把万载的火光送到了世界的每一个角落。

如今环保要求高了，花炮厂都在转型升级，微烟、无硫的环保烟花越来越多。过年放鞭炮的规矩也变了，但那份刻在骨子里的对火光的热爱没有变。

每次回到万载，闻到空气中隐约的硫磺香，我就知道：到家了。',
NULL, 'approved', 680, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-huapao-tongnian'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品3：《夏布上的时光》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-xiabu-shiguang',
  '夏布上的时光',
  'essay',
  '苎麻在万载人手里变成了布，一千六百年的时光就织进了每一根纱线里。外国人叫它"中国草"，万载人叫它"鸡鸣布"。',
  NULL,
  '田下客',
  NULL,
  'approved',
  8,
  1,
  650,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '夏布上的时光',
'在万载古城的夏布体验坊里，我第一次见到了织布的全过程。

匠人坐在老式的木织机前，双脚交替踩动踏板，手中的梭子在经线之间来回穿梭。"哐当、哐当"，机杼声不急不缓，像一首古老的歌谣。织出来的布色白微黄，纹理细密，摸上去有一种天然的粗糙与柔韧。

这就是夏布。

万载夏布的历史，可以追溯到一千六百多年前。原料是本地种植的苎麻——外国人叫它"中国草"。从苎麻到夏布，要经过剥麻、绩纱、浆纱、织布等十几道工序，全靠手工。绩纱是最费功夫的环节，需要把麻皮劈成细如发丝的纤维，再一根根捻接成纱线。万载的妇女们常常一边看电视一边绩纱，手指翻飞间，一团乱麻就变成了规整的纱锭。

因为织布常常要赶在天亮前完成，所以夏布还有一个名字叫"鸡鸣布"——鸡叫时分，布就织好了。

唐朝时，万载夏布是贡品。到了清代和民国，万载夏布远销朝鲜、日本和东南亚，是当地外贸的大宗商品。直到今天，每年仍有大批韩国、日本客商来万载订货。

我买了一条夏布围巾，围在脖子上，透气、凉爽，带着一股植物的清香。匠人说，夏布越用越软，越洗越亮，一条好的夏布可以用几十年。

一条布能用几十年，一门手艺传了一千六百年。时光在夏布上，走得很慢很慢。',
NULL, 'approved', 650, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-xiabu-shiguang'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品4：《田下祠堂记》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-tianxia-citang',
  '田下祠堂记',
  'story',
  '十三个姓氏，二十七座祠堂，为什么都建在同一片土地上？这个问题，我在万载古城找到了答案。',
  NULL,
  '田下客',
  NULL,
  'approved',
  7,
  1,
  700,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '田下祠堂记',
'第一次去万载古城，我就被那片祠堂群震住了。

二十七座明清至民国时期的古祠堂，密密麻麻地挤在田下街区，涵盖辛、宋、郭、彭、闻、易、周、张、高、鲍、陈、龙、欧阳十三个姓氏。全国哪里还有这样的景象？不同姓氏的祠堂挨在一起，门对门、墙接墙，像是一场跨越数百年的家族聚会。

我问当地的老人：为什么这么多姓氏把祠堂建在一起？

老人抽了一口烟，慢慢说：万载是移民县。元末明初，战乱不断，江西北部人口锐减，朝廷组织从福建、广东等地移民填充。这些移民来到万载，划地而居，各自开枝散叶。田下这地方地势平坦、水源充足，大家都看中了，于是各姓各建祠堂，比邻而居。

"住得近了，难免有矛盾。"老人笑了笑，"但祠堂建在一起，抬头不见低头见，谁家有个红白喜事，隔壁姓氏也来帮忙。几百年下来，就成了现在这个样子。"

我走进郭氏宗祠。这座祠堂始建于明天启七年，供奉的是郭子仪的后裔——唐代那个"功盖天下而主不疑"的汾阳王。祠堂的梁柱上刻着家训，正堂的匾额写着"汾阳世第"。阳光从天井洒下来，照在斑驳的青砖上，仿佛能听见几百年前的族训声。

绿荫公祠是古城里规模最大、工艺最精的祠堂，重檐歇山顶，木雕灰塑极尽精巧。如今它变身为祠堂文化馆，展示万载的宗族文化。我站在祠堂的回廊下，看着那些精美的雀替和驼峰，忽然理解了什么叫"赣派建筑的符号代表"。

走出祠堂群，天色已晚。各姓祠堂的门口都挂起了红灯笼，远远望去，一片温暖的红光。

十三个姓氏，二十七座祠堂，几百年的比邻而居。这不是巧合，是万载人的智慧——和而不同，聚而共生。',
NULL, 'approved', 700, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-tianxia-citang'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品5：《一碗扎粉》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-ywan-zhafen',
  '一碗扎粉',
  'essay',
  '罗城扎粉是万载人的早餐标配，也是游子的乡愁。猛火快炒，根根分明，裹着酱香与鲜辣，一口就是家的味道。',
  NULL,
  '田下客',
  NULL,
  'approved',
  6,
  1,
  600,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '一碗扎粉',
'万载人的早晨，是从一碗扎粉开始的。

罗城扎粉，因产于万载罗城镇而得名，是江西省级非物质文化遗产（2010年列入江西省第三批省级非遗名录），距今已有五百多年历史，明时起源于泰溪河两岸。以本地早米为原料，经浸磨、扎制、日晒等传统工艺制成。粉条约两三毫米粗，色白如银，柔韧爽滑，久煮不烂。

我最喜欢的吃法是炒扎粉。老板把泡软的扎粉沥干，猛火烧锅，下猪油，爆香蒜末和干辣椒，倒入扎粉快速翻炒。加酱油、盐、少许味精，再撒一把韭菜和豆芽，颠几下锅，出锅。整个过程不超过三分钟。

端上来的炒扎粉根根分明，油光锃亮，裹着酱香与鲜辣。一口下去，米粉的柔韧、韭菜的清香、辣椒的刺激在嘴里交织，带着一种独特的发酵微香。配上一碗紫菜蛋汤，就是万载人最满足的早餐。

在外读书的时候，最想念的就是这碗炒扎粉。学校食堂的米粉要么太烂，要么没味道，怎么也吃不出家乡的感觉。有一次寒假回来，下了火车第一件事就是直奔常去的那家粉店，老板看见我就笑："回来了？还是老样子？"我点点头，坐下来，等那碗熟悉的炒扎粉端上来，吃第一口的时候，眼泪差点掉下来。

后来才知道，罗城扎粉的制作工艺比想象中复杂。早米要浸泡三天三夜，磨成米浆后蒸熟，再用特制的工具扎成粉条，最后在阳光下晾晒。每一道工序都靠经验，水温、时间、晾晒的程度，差一点味道就不一样。

如今，罗城扎粉已经走出了万载，在宜春、南昌甚至外地的江西菜馆都能吃到。但我总觉得，只有在万载本地的小店里，用猛火快炒出来的那一碗，才是真正的味道。

因为那碗粉里，炒的不只是米粉，还有乡愁。',
NULL, 'approved', 600, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-ywan-zhafen'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品6：《得胜鼓响起的时候》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-deshenggu',
  '得胜鼓响起的时候',
  'essay',
  '国家级非遗万载得胜鼓，鼓声铿锵，再现古代将士凯旋的盛况。那鼓点里，有万载人的血性与豪情。',
  NULL,
  '田下客',
  NULL,
  'approved',
  5,
  1,
  580,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '得胜鼓响起的时候',
'在万载古城，只要得胜鼓一响，所有人都会停下脚步。

那鼓声不是普通的鼓点，是一种从胸腔里震出来的力量。"咚——咚咚——咚锵！"大鼓、小鼓、大钹、小钹、唢呐，十几样乐器合奏，气势磅礴，仿佛千军万马踏地而来。

得胜鼓是国家级非物质文化遗产，起源于唐宋时期。传说当年将士出征，百姓击鼓送行；将士凯旋，百姓击鼓相迎。久而久之，这种鼓乐就被称为"得胜鼓"。万载得胜鼓保留了古代军乐的雄浑风格，鼓点节奏多变，有"行军""交战""凯旋"等不同段落，听一场得胜鼓，就像看了一场古代战争的有声画卷。

我第一次现场听得胜鼓，是在古城的非遗展演上。十几个艺人穿着统一的服装，领头的是一位六十多岁的老师傅，手持鼓槌，双目如炬。他一槌下去，大鼓发出沉闷的巨响，紧接着小鼓跟上，钹声切入，唢呐拔高，整个广场都被鼓声笼罩。

周围的观众不自觉地跟着鼓点拍手，孩子们兴奋地蹦跳，老人们则闭目聆听，脸上是一种肃穆而激动的表情。我站在人群中，感受着胸腔随着鼓点共振，忽然理解了为什么这种鼓乐能传承一千多年——它不是表演，是一种集体记忆的唤醒。

老师傅告诉我，得胜鼓的传承不容易。学鼓要从基本功练起，手腕的力度、节奏的把控、与其他乐器的配合，没有三五年上不了台。现在年轻人愿意学的不多了，但只要还有人敲，这鼓声就不会断。

展演结束，鼓声渐渐远去，但那"咚咚"的回响似乎还留在耳边。我回头看了一眼古城的飞檐，心想：只要得胜鼓还在响，万载的精气神就还在。',
NULL, 'approved', 580, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-deshenggu'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品7：《百合故里》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-baihe-guli',
  '百合故里',
  'essay',
  '万载白水是龙牙百合的故乡，五百多年种植历史，三年一收。百合花开的时候，整个山坡都是白色的。',
  NULL,
  '田下客',
  NULL,
  'approved',
  4,
  1,
  620,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '百合故里',
'万载有两样东西最出名：一样是花炮，一样是百合。

花炮是天上的花，百合是地里的花。

万载龙牙百合的种植历史，据县志记载已有五百多年，自宋朝起便是朝廷贡品，明清两代历朝相延。核心产区在白水乡——一个藏在万载西北部山区的乡镇。这里的土壤富含硒元素，气候湿润，昼夜温差大，种出来的百合鳞茎肥厚、肉质细腻、味道甘甜，被誉为"百合中的上品"。

我去过一次白水，正是六月百合花开的季节。车子沿着盘山公路往上走，转过一个弯，忽然眼前一亮——漫山遍野的白色百合花，在阳光下开得轰轰烈烈。百合花的形状像喇叭，花瓣向外翻卷，露出里面淡黄色的花蕊，风一吹，整片花田就像白色的波浪在翻滚。

同行的老乡告诉我，龙牙百合是"三年一收"。第一年种下种球，第二年长叶开花，第三年才能收获鳞茎。这三年里，不能施化肥，不能打农药，全靠农家肥和人工除草。收获的时候，用锄头小心翼翼地把鳞茎从土里挖出来，去掉泥土和根须，就是新鲜的龙牙百合了。

新鲜百合可以清炒、蒸制、炖汤，口感清甜脆嫩，自带一种独特的鲜香。但更多的百合被加工成了百合粉——经过磨浆、过滤、沉淀、烘干等多道工序，最终变成细腻洁白的粉末。百合粉温润护胃，是万载人走亲访友的必备伴手礼。1959年和1970年两次庐山会议，都曾专门调用万载龙牙百合粉。

老乡说，以前种百合是为了谋生，现在种百合是为了传承。年轻人都出去打工了，留在山里种百合的大多是五六十岁的老人。但只要还有人种，这五百多年的百合根就不会断。

离开白水的时候，我买了一袋新鲜百合和一罐百合粉。车开出去很远，回头还能看见山坡上那片白色的花田。

那是万载的另一种"焰"——不是火光，是花开。',
NULL, 'approved', 620, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-baihe-guli'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);

-- ============================================================
-- 作品8：《傩面背后》
-- ============================================================
INSERT OR IGNORE INTO books (slug, title, category, intro, cover, author_name, writer_id, status, sort_weight, chapter_count, word_count, views, created_at, updated_at) VALUES (
  'b-nuomian-beihou',
  '傩面背后',
  'story',
  '开口傩是万载独有的傩戏，戴着面具唱跳，驱邪祈福。每一张傩面背后，都藏着一个古老的故事。',
  NULL,
  '田下客',
  NULL,
  'approved',
  3,
  1,
  650,
  0,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO book_chapters (book_id, idx, title, body, images, status, word_count, created_at, updated_at)
SELECT id, 1, '傩面背后',
'万载的傩戏，叫"开口傩"。

和其他地方的傩戏不同，万载开口傩的表演者是戴着面具开口唱的——这在全国傩戏中都极为罕见。面具一戴，人就不再是自己，而成了面具上的那个神：开山、钟馗、土地、雷公……

我在古城的非遗展演上看过一次开口傩。锣鼓声中，几个戴着彩色面具的人跳了出来，面具表情夸张，有的怒目圆睁，有的笑容可掬，有的青面獠牙。他们穿着古装，手持兵器，一边跳跃一边唱念，唱腔古朴，动作粗犷。

最让我印象深刻的是"开山神"的面具。那张面具是红色的，额头突出，眼睛暴凸，嘴巴大张，露出两颗獠牙，看起来凶神恶煞。但表演者告诉我，开山神是驱邪纳福的善神，看起来越凶，驱邪的力量就越强。

展演结束后，我找到了傩戏班的老艺人，想看看面具的制作过程。老艺人姓周，七十多岁了，做了一辈子傩面。他的工作台上摆着各种工具：刻刀、凿子、砂纸、颜料。一张傩面从选料到成品，要经过选木、开坯、雕刻、打磨、上漆、彩绘等十几道工序，至少需要半个月。

"做傩面，最重要的不是手艺，是心。"周师傅一边打磨面具一边说，"你心里敬这个神，刻出来的面具才有灵气。心里不敬，刻得再像也只是个木头壳子。"

他拿起一张刚做好的钟馗面具，递给我看。面具的眼神栩栩如生，仿佛下一秒就要活过来。我伸手摸了摸，木头的纹理在指尖划过，能感觉到手工雕刻的温度。

周师傅说，开口傩最鼎盛的时候，万载有几十个傩戏班，村村都有傩庙。现在只剩下两三个班了，年轻人不愿意学，觉得又苦又不赚钱。但每年过年，只要傩戏班一出门，家家户户还是会放鞭炮迎接，请傩神到家里跳一圈，驱邪祈福。

"只要还有人看，我就一直跳。"周师傅把傩面戴在脸上，透过面具的眼洞看着我，"面具戴久了，就分不清哪个是面具，哪个是自己了。"

我看着他戴着傩面的样子，忽然觉得：那些古老的神，并没有消失。他们就藏在一张张傩面背后，等着被人戴上，重新活过来。',
NULL, 'approved', 650, datetime('now'), datetime('now')
FROM books WHERE slug = 'b-nuomian-beihou'
AND NOT EXISTS (SELECT 1 FROM book_chapters c WHERE c.book_id = books.id AND c.idx = 1);
