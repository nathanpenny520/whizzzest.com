-- 007 用户级在线（docs/IM在线与实时同步方案.md P1，业主拍板「登录即在线」）：
-- 常驻 /ws 存在性连接心跳落库；在线 = now - last_ping < 90s（读时计算，异常断线自愈，无需 alarm）
CREATE TABLE IF NOT EXISTS im_presence (
  uid       INTEGER PRIMARY KEY,
  last_ping INTEGER NOT NULL DEFAULT 0  -- epoch ms
);
