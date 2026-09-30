-- 00027_drop_rt_diag.sql
--
-- 清理验证用的临时诊断表 public.__rt_diag（P0-1 验证 00026 时由 dashboard 手工建出）。
-- 该表位于 public 且曾对 anon/authenticated 开放写权限，属多余暴露面，删除之。
-- 本迁移不触碰 realtime 模式，纯 public DDL，GitHub 集成以 postgres 角色可正常执行。
drop table if exists public.__rt_diag;
