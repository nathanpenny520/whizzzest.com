# game/scripts/archive/ — 一次性/单款专用脚本归档（2026-09-10，结构精简 A2）

> 归档原则：**只移动、不删除**（遵守看板 2026-09-10「清扫误删 win12 工具」事故的教训——工具永远留在 git 里，只是离开常驻视线）。运行时管线与通用诊断脚本**不在此目录**（见上级目录）。

| 脚本 | 用途 | 归档原因 |
|---|---|---|
| dos-diag.mjs | DOS 专区 12 款全黑诊断（js-dos.css 缺失） | 单款事件热修工具，DOS 专区已修复上线 |
| catcity-save-test.mjs | CatCity 存档镜像补丁验证 | 批次五单款收录验收，已交付 |
| chess-smoke.mjs | chinese-chess 单款冒烟 | 单款专用冒烟，收录已交付 |
| clean-emberquest.mjs | EmberQuest 包清洗 | 头注释自述一次性，清洗已完成 |
| _win12-lang-clean.mjs | win12 主题语言清洗 | win12 已交付；三件套曾因 `/_` 通配误删又还原（看板事故复盘），现正式归档留档 |
| _win12-probe.mjs | win12 探针 | 同上 |
| _win12-verify.mjs | win12 验收 | 同上；输出路径仍写 game/scripts/_win12-verify.*，复用时注意 |
| upload-theme-mirror.mjs | win12 主题库一次性 R2 上传 | 主题库已上传完毕 |

已知问题（复用前需修）：本目录部分脚本 chrome 路径写作 `'C:\Program Files\...'`（单反斜杠，`\P` 转义后变 `P`，existsSync 永假），且写死了 `game/scripts/` 相对输出路径——归档后路径深度变化，复用前先改。
