-- ============================================================
-- 微信式功能扩展 schema
-- users(昵称即账号) / friends(好友关系) / room_members(群成员) / message_reads(已读)
-- 并为 messages 增加 withdrawn_at(撤回时间)
-- 应用方式：在 Supabase 控制台 SQL Editor 一次性执行本文件
-- ============================================================

-- 注：库中已存在的 public.user_profiles 是早期"邮箱+密码"注册方案的遗留表，
-- 当前代码零引用且为空表。本项目采用"昵称即身份 + 全局访问密码"模型，
-- 故另建下面的 users 表，不复用 user_profiles。

-- 1. users 表：昵称即账号，持久化头像/签名/活跃时间
CREATE TABLE IF NOT EXISTS public.users (
    nickname      TEXT PRIMARY KEY,
    avatar        TEXT,
    signature     TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_nickname_lower ON public.users (lower(nickname));

-- 2. friends 表：双向关系（user_a < user_b 字典序存储单行）
CREATE TABLE IF NOT EXISTS public.friends (
    user_a       TEXT NOT NULL,
    user_b       TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
    requested_by TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_a, user_b),
    FOREIGN KEY (user_a) REFERENCES public.users (nickname) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES public.users (nickname) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friends_b ON public.friends (user_b);
CREATE INDEX IF NOT EXISTS idx_friends_status ON public.friends (status);

-- 3. room_members 表：群成员 + 角色
CREATE TABLE IF NOT EXISTS public.room_members (
    room_id   TEXT NOT NULL,
    "user"    TEXT NOT NULL,
    role      TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, "user")
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members ("user");

-- 4. message_reads 表：已读回执（每用户每条消息一行）
CREATE TABLE IF NOT EXISTS public.message_reads (
    message_id TEXT NOT NULL,
    room_id    TEXT NOT NULL,
    "user"     TEXT NOT NULL,
    read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, "user")
);
CREATE INDEX IF NOT EXISTS idx_message_reads_room ON public.message_reads (room_id);

-- 5. messages 增加撤回时间
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

-- 6. RLS：应用统一走 service_role 写，anon/authenticated 允许读取（与 messages 表策略一致）
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

-- 读取策略（anon + authenticated 可读，写操作由 API 路由以 service_role 执行，service_role 绕过 RLS）
DROP POLICY IF EXISTS "Allow read users"        ON public.users;
CREATE POLICY "Allow read users"        ON public.users        FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Allow read friends"      ON public.friends;
CREATE POLICY "Allow read friends"      ON public.friends      FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Allow read room_members" ON public.room_members;
CREATE POLICY "Allow read room_members" ON public.room_members FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Allow read message_reads" ON public.message_reads;
CREATE POLICY "Allow read message_reads" ON public.message_reads FOR SELECT TO anon, authenticated USING (true);

-- service_role 全权（显式声明，防御性）
DROP POLICY IF EXISTS "Service role full users"        ON public.users;
CREATE POLICY "Service role full users"        ON public.users        FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full friends"      ON public.friends;
CREATE POLICY "Service role full friends"      ON public.friends      FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full room_members" ON public.room_members;
CREATE POLICY "Service role full room_members" ON public.room_members FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full message_reads" ON public.message_reads;
CREATE POLICY "Service role full message_reads" ON public.message_reads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. 种子：把历史聊天过的昵称导入 users，便于搜索/通讯录/头像初始化
INSERT INTO public.users (nickname, created_at)
SELECT DISTINCT "user", NOW()
FROM public.messages
WHERE "user" IS NOT NULL AND "user" <> ''
  AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.nickname = messages."user")
ON CONFLICT (nickname) DO NOTHING;
