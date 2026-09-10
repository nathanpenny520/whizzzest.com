# scripts/archive/ — 一次性工具归档（2026-09-10，结构精简 A2）

> 归档原则：只移动、不删除，git 历史与磁盘均保留。常驻工具（ai-retrieval-test / fetch-bili-covers / smoke.sh / migrations）在上级目录。

| 工具 | 用途 | 归档原因 |
|---|---|---|
| extract-content.py | 旧站（reference/old-site）内容迁移到 src/data | 迁移 2026-09-06/07 已完成；reference/ 已按业主拍板删除，脚本永久失效，仅留档 |
| ai-seed.sql | AI 知识库 68 条种子（首次上线执行） | 已执行完毕；admin AI Tab 空态提示中的路径已同步改为本归档路径 |
| library-seed.sql / merchants-seed.sql / attractions-seed.sql | 文库/商户/景点 D1 种子 | 均已执行（文件头自述「仅首次上线执行一次」） |
| gen-icons.js | PWA 图标一次性生成（sharp + png-to-ico） | 图标产物已提交入库；若日后换图标，从本目录取用后放回或就地运行均可 |
