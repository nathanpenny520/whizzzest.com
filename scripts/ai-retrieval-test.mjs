/**
 * AI 检索回归集（金标准）——纯 Node 跑 worker/ai.js 的检索纯函数，验证混合检索行为。
 *
 *   node scripts/ai-retrieval-test.mjs
 *
 * 语义通道以 {id, score} 假分数注入（mergeHybrid 不碰真实向量），
 * 改检索逻辑（换模型/调权重/换地板）后先跑本集，对比命中再上线。
 * 语义通道的真实质量需在线上用 docs/AI助手方案.md §知识缺口报表观察。
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/* worker/ai.js 是 Worker 入口模块（.js 无 type:module，Node 按 CJS 解析失败），
   这里镜像成 .mjs 临时文件导入，保证测的就是 worker 源码本体 */
const src = new URL('../worker/ai.js', import.meta.url).pathname;
const dir = mkdtempSync(tmpdir() + '/ai-test-');
writeFileSync(dir + '/ai.mjs', await import('node:fs').then((m) => m.readFileSync(src, 'utf8')));
const { retrieveKnowledge, scoreKnowledge, expandQuery, PAGE_ROUTE_RE } = await import(pathToFileURL(dir + '/ai.mjs').href);

/* 与 scripts/ai-seed.sql 同构的迷你知识库（字段：id/category/content/keywords） */
const ROWS = [
  { id: 1, category: '烟花文化', content: '万载花炮始于清道光年间，花炮节上有周末焰火表演，古城夜常有烟花秀。', keywords: ['烟花', '花炮', '焰火', '花炮节'] },
  { id: 2, category: '美食特产', content: '万载三大碗、扎粉、百合粉、南酒是本地代表美食。', keywords: ['美食', '三大碗', '扎粉', '百合', '南酒'] },
  { id: 3, category: '旅游景点', content: '田下古城、龙湖公园、恒晖艺术农业基地是主要游玩景点，龙湖公园适合亲子散步。', keywords: ['景点', '古城', '龙湖公园', '旅游', '亲子'] },
  { id: 4, category: '非遗文化', content: '开口傩、得胜鼓、花灯戏等列入非物质文化遗产名录。', keywords: ['非遗', '傩', '花灯戏', '得胜鼓'] },
  { id: 5, category: '旅游线路', content: '一日游线路：田下古城→王朝大酒店午餐→龙湖公园→晚上看焰火。', keywords: ['线路', '一日游', '行程', '亲子'] },
  { id: 6, category: '实用信息', content: '高铁万载西站已通，自驾导航古城停车场；交通指南见站内。', keywords: ['交通', '高铁', '车站', '停车场'] },
  { id: 7, category: '历史沿革', content: '古城墙始建于宋代，明代重修，是万载建县一千六百年的见证。', keywords: ['历史'] },
];

const ENTITIES = [
  { kind: 'attraction', name: '龙湖公园', info: '城中湖景公园' },
  { kind: 'attraction', name: '恒晖艺术农业基地', info: '田园综合体' },
  { kind: 'merchant', name: '王朝大酒店', info: '[住宿] 老牌星级酒店' },
];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
}
function ids(list) { return list.map((k) => k.id); }

console.log('— 泛词扩展 —');
check('「好吃的」扩展出 美食', expandQuery('有什么好吃的').includes('美食'));
check('「带孩子」扩展出 亲子', expandQuery('带孩子去哪玩').includes('亲子'));
check('无口语词不追加', expandQuery('花炮节') === '花炮节');

console.log('— 关键词 + 泛词召回 —');
let top = retrieveKnowledge('万载有啥好吃的？', ROWS);
check('口语「有啥好吃的」命中美食', ids(top).includes(2), JSON.stringify(ids(top)));
top = retrieveKnowledge('晚上去哪里玩', ROWS);
check('「去哪里玩」命中景点', ids(top).includes(3), JSON.stringify(ids(top)));
top = retrieveKnowledge('花炮节是什么时候', ROWS);
check('精确关键词 花炮节 居首', top[0]?.id === 1, JSON.stringify(ids(top)));

console.log('— 正文互证（keywords 挑漏可捞回）—');
const s7 = scoreKnowledge('古城墙什么时候建的', ROWS).find((x) => x.k.id === 7);
check('正文含「古城墙」的沿革条目获得计分', (s7?.score || 0) >= 1, JSON.stringify(ids(top)));

console.log('— 语义通道（地板 0.42 / 权重 12，2026-09-08 线上校准）—');
top = retrieveKnowledge('带女朋友去哪里约会比较浪漫', ROWS, [{ id: 3, score: 0.62 }]);
check('语义 0.62 把景点条目拉进 Top-3', ids(top).includes(3), JSON.stringify(ids(top)));
top = retrieveKnowledge('完全不相关的问题', ROWS, [{ id: 2, score: 0.25 }]);
check('语义 0.25 低于地板不计分', !ids(top).includes(2), JSON.stringify(ids(top)));
top = retrieveKnowledge('完全不相关的问题', ROWS, [{ id: 2, score: 0.4 }]);
check('语义 0.40（线上实测噪声上限）不计分', !ids(top).includes(2), JSON.stringify(ids(top)));
top = retrieveKnowledge('推荐美食', ROWS, [{ id: 4, score: 0.6 }]);
check('关键词与语义叠加排序靠前', top[0]?.id === 2, JSON.stringify(ids(top)));

console.log('— 实体名直配（修 Top8 盲区）—');
top = retrieveKnowledge('王朝大酒店怎么样', ROWS, [], ENTITIES);
check('商户实体命中且类目标为 商户', top[0]?.id === 'e王朝大酒店' && top[0]?.category === '商户', JSON.stringify(ids(top)));
top = retrieveKnowledge('龙湖公园门票多少钱', ROWS, [], ENTITIES);
check('景点实体命中', ids(top).includes('e龙湖公园'), JSON.stringify(ids(top)));
top = retrieveKnowledge('有什么好玩的地方', ROWS, [], ENTITIES);
check('无关实体不误配', !ids(top).some((x) => typeof x === 'string'), JSON.stringify(ids(top)));

console.log('— open_page 路由白名单 —');
check('站内板块放行', PAGE_ROUTE_RE.test('/digital-fireworks/'));
check('动态详情放行', PAGE_ROUTE_RE.test('/merchants/wangchao-hotel'));
check('音乐深链由服务端直构（不经正则）', !PAGE_ROUTE_RE.test('/music/?t=3'));
check('外域拒绝', !PAGE_ROUTE_RE.test('https://evil.example'));
check('伪路由拒绝', !PAGE_ROUTE_RE.test('/about/../../../admin'));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
