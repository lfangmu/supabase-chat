-- 注册/登录：users 表增加密码哈希列
-- nickname 仍是主键（天然唯一），password_hash 用于注册/登录校验。
-- 旧的无密码昵称行 password_hash 为 NULL，只能重新注册（昵称被占用时会提示"已被注册"）。
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
