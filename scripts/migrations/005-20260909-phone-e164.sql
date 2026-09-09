-- 迁移 005：门户手机号统一 E.164（docs/手机号国际化方案.md）——幂等，可安全重跑
-- 存量手机号受旧正则 /^1\d{10}$/ 约束必为中国号，统一补 +86 前缀；迁移前全表唯一 → 补前缀后仍唯一
-- 注意窗口：旧代码按裸 11 位查询，生产执行后须同窗口部署 writer/merchant 两 Worker 新版
-- 执行：wrangler d1 execute whizzzest --remote --file scripts/migrations/005-20260909-phone-e164.sql
--       wrangler d1 execute whizzzest --local  --file scripts/migrations/005-20260909-phone-e164.sql
-- 执行记录：生产 ⏳（随两门户上线同窗口执行）；本地 ⏳
UPDATE merchant_users SET phone = '+86' || phone WHERE phone NOT LIKE '+%';
UPDATE writer_users  SET phone = '+86' || phone WHERE phone IS NOT NULL AND phone NOT LIKE '+%';
