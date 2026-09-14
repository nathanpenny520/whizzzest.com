-- 008: IM 批量会话操作（业主拍板四项：删除/标已读/置顶/免打扰，2026-09-14）
-- 库：whizzzest；本迁移只增列，不动既有数据
-- 007 归「IM 在线判定与实时同步」会话（im_presence），本行为 008（看板行 40/41 注记）
-- hidden=1：会话从列表隐藏（仅 1v1；隐藏同时 min_seq 顶到当前最大 seq、已读位同步顶满——
--           对端来新消息经 room.js 发送钩子解除隐藏，旧历史不回灌）
-- pinned / muted：列表置顶排序与未读红点抑制（convsList 直出，前端消费）

ALTER TABLE im_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE im_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE im_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
