-- ============================================================
-- 00020 — 身份模型迁移：昵称 → auth.uid()(UUID)
--
-- 背景：方案三（基于 Supabase Auth 重建鉴权）。当前所有关系列（room_members."user"、
--       rooms.created_by、friends.user_a/user_b、messages."user"、reactions."user"、
--       push_subscriptions."user"、message_reads."user"）都以「昵称」为身份锚点，
--       且实时投递用 /api/realtime-token 把昵称顶替进 auth.uid()。
--
-- 目标：统一为 Supabase Auth 的 auth.uid()(UUID)。
-- 前提：用户明确「不考虑历史数据、直接重建」，故先 TRUNCATE 应用表，删除 user_profiles 遗留表，
--       再改列类型 / 外键。auth.users（Supabase 托管）保留。
-- ============================================================

-- 0. 清空应用数据（保留 auth.users）
TRUNCATE TABLE public.message_reads,
             public.reactions,
             public.push_subscriptions,
             public.room_members,
             public.friends,
             public.messages,
             public.rooms
             RESTART IDENTITY CASCADE;

-- 1. users：重建为主键 = auth.users.id（UUID）
--    DROP CASCADE 会一并移除 friends / room_members 上指向 users(nickname) 的旧外键。
DROP TABLE IF EXISTS public.users CASCADE;
CREATE TABLE public.users (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name   text NOT NULL,
  avatar         text,
  signature      text NOT NULL DEFAULT '',
  role           text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_users_display_name_lower ON public.users (lower(display_name));
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 2. messages：保留 denorm 的 "user"(展示名文本，避免前端全量改写渲染)，新增 user_id(uuid) 身份列
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.messages
  ADD CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES public.users(id);

-- 3. rooms.created_by → uuid（指向 users.id）
ALTER TABLE public.rooms
  ALTER COLUMN created_by TYPE uuid USING (created_by::uuid);
ALTER TABLE public.rooms
  ADD CONSTRAINT fk_rooms_created_by FOREIGN KEY (created_by) REFERENCES public.users(id);

-- 4. room_members."user" → user_id uuid，并重设主键
ALTER TABLE public.room_members RENAME COLUMN "user" TO user_id;
ALTER TABLE public.room_members
  ALTER COLUMN user_id TYPE uuid USING (user_id::uuid);
ALTER TABLE public.room_members DROP CONSTRAINT IF EXISTS room_members_pkey;
ALTER TABLE public.room_members
  ADD PRIMARY KEY (room_id, user_id);
ALTER TABLE public.room_members
  ADD CONSTRAINT fk_room_members_user FOREIGN KEY (user_id) REFERENCES public.users(id);

-- 5. friends.user_a / user_b / requested_by → uuid
ALTER TABLE public.friends
  ALTER COLUMN user_a TYPE uuid USING (user_a::uuid);
ALTER TABLE public.friends
  ALTER COLUMN user_b TYPE uuid USING (user_b::uuid);
ALTER TABLE public.friends
  ALTER COLUMN requested_by TYPE uuid USING (requested_by::uuid);
ALTER TABLE public.friends
  ADD CONSTRAINT fk_friends_a  FOREIGN KEY (user_a)       REFERENCES public.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_friends_b  FOREIGN KEY (user_b)       REFERENCES public.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_friends_req FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE CASCADE;

-- 6. reactions."user" → user_id uuid
ALTER TABLE public.reactions RENAME COLUMN "user" TO user_id;
ALTER TABLE public.reactions
  ALTER COLUMN user_id TYPE uuid USING (user_id::uuid);
ALTER TABLE public.reactions
  ADD CONSTRAINT fk_reactions_user FOREIGN KEY (user_id) REFERENCES public.users(id);

-- 7. push_subscriptions."user" → user_id uuid
ALTER TABLE public.push_subscriptions RENAME COLUMN "user" TO user_id;
ALTER TABLE public.push_subscriptions
  ALTER COLUMN user_id TYPE uuid USING (user_id::uuid);
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES public.users(id);

-- 8. message_reads."user" → user_id uuid
ALTER TABLE public.message_reads RENAME COLUMN "user" TO user_id;
ALTER TABLE public.message_reads
  ALTER COLUMN user_id TYPE uuid USING (user_id::uuid);
ALTER TABLE public.message_reads
  ADD CONSTRAINT fk_message_reads_user FOREIGN KEY (user_id) REFERENCES public.users(id);

-- 9. 删除遗留的 user_profiles 表（早期「邮箱+密码」方案，当前代码零引用、为空表）
DROP TABLE IF EXISTS public.user_profiles CASCADE;

-- 10. 重新种入默认公共大厅（created_by 为 NULL，is_room_participant 对 default-room 直接放行）
INSERT INTO public.rooms (id, name, created_by, type)
VALUES ('default-room', '默认聊天室', NULL, 'public')
ON CONFLICT (id) DO NOTHING;
