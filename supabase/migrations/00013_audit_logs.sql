-- ============================================================
-- 管理后台操作审计日志
-- 记录管理员的所有敏感操作（删除房间、删除消息等）
-- ============================================================

-- 1. 创建 audit_logs 表
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    action      TEXT NOT NULL,                          -- 操作类型：delete_room, delete_message, etc.
    target_type TEXT NOT NULL,                          -- 目标类型：room, message, user
    target_id   TEXT,                                   -- 目标 ID
    details     JSONB,                                  -- 详细信息（被删除的内容摘要等）
    admin_ip    TEXT,                                   -- 管理员 IP
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 索引
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON public.audit_logs (action, created_at DESC);

-- 3. 启用 RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS 策略：只有 service_role 可以读写（通过 API 路由访问）
-- anon 和 authenticated 都不能直接访问 audit_logs
DROP POLICY IF EXISTS "Audit logs not accessible via anon" ON public.audit_logs;
CREATE POLICY "Audit logs not accessible via anon"
    ON public.audit_logs
    FOR SELECT
    TO anon
    USING (false);

DROP POLICY IF EXISTS "Audit logs not accessible via authenticated" ON public.audit_logs;
CREATE POLICY "Audit logs not accessible via authenticated"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (false);

-- 注意：service_role 绕过 RLS，所以可以正常读写
