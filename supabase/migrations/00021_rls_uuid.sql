-- ============================================================
-- 00021 — RLS + is_room_participant 重写为 UUID 身份
--
-- 配套 00020：身份列已改为 UUID。这里把 is_room_participant 的 p_actor 从 text 改为 uuid，
-- 并把全部 RLS 策略从「昵称比较 / anon 可读」改为「auth.uid() 比较 / 仅 authenticated 可读」。
-- 实时投递（postgres_changes）依赖本文件的 SELECT 策略按房间成员过滤。
--
-- 注意：Supabase 的 service_role 默认绕过 RLS，故 service_role 策略仅为显式兜底；
-- 真正的写入仍走服务端 API（getServiceClient，SUPABASE_SERVICE_ROLE_KEY）。
-- ============================================================

-- 0. 清理旧策略与旧函数（幂等、按名删除，避免遗留的 anon/宽松策略或重名函数造成冲突）
DO $$
DECLARE
  r record;
BEGIN
  -- 删除 8 张应用表上所有既有 RLS 策略（无论旧名是什么），稍后统一重建
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'messages', 'users', 'room_members', 'friends',
        'reactions', 'push_subscriptions', 'message_reads', 'rooms'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- 删除旧签名（text, text）的 is_room_participant，避免与新的 (text, uuid) 重载并存导致歧义/失效
DROP FUNCTION IF EXISTS public.is_room_participant(text, text);
-- 删除旧 get_room_last_messages（5 列、无 user_id），否则 CREATE OR REPLACE 因返回类型变化报错
DROP FUNCTION IF EXISTS public.get_room_last_messages(text[]);

-- 1. is_room_participant(p_room text, p_actor uuid)
--    SECURITY DEFINER + SET search_path 防搜索路径注入，内部读取 rooms / room_members 不受调用者 RLS 影响。
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room text, p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_member     uuid;
BEGIN
  IF p_room IS NULL OR p_actor IS NULL THEN
    RETURN false;
  END IF;

  -- 全局公共大厅：任何已登录用户可读
  IF p_room = 'default-room' THEN
    RETURN true;
  END IF;

  -- 私聊房间：dm:<uuidA>:<uuidB> —— actor 须为其中一方参与者
  IF p_room LIKE 'dm:%' THEN
    RETURN p_actor = ANY (string_to_array(split_part(p_room, 'dm:', 2), ':')::uuid[]);
  END IF;

  -- 普通群：创建者 或 成员行存在
  SELECT created_by INTO v_created_by
  FROM rooms WHERE id = p_room;
  IF FOUND AND v_created_by = p_actor THEN
    RETURN true;
  END IF;

  SELECT user_id INTO v_member
  FROM room_members WHERE room_id = p_room AND user_id = p_actor LIMIT 1;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_room_participant(text, uuid) TO authenticated, anon;

-- 2. messages RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

CREATE POLICY "Authenticated members can read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_room_participant(room_id, auth.uid()));

CREATE POLICY "Insert own messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Update own messages"
  ON public.messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Delete own messages"
  ON public.messages FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full messages"
  ON public.messages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. users RLS
--    关键安全点：role 列绝不允许客户端直写——通过「列级 GRANT」只开放 profile 字段的 UPDATE，
--    防止普通用户把 role 改成 'admin' 提权。role 只能由 service_role 修改。
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE (display_name, avatar, signature, last_active_at) ON public.users TO authenticated;

CREATE POLICY "Read profiles" ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Update own profile" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Service role full users" ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. room_members RLS
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_members TO authenticated;

CREATE POLICY "Read room_members" ON public.room_members FOR SELECT TO authenticated USING (true);
-- 关键：只允许「以 member 身份加入自己」——FOR ALL + 仅校验 user_id 会让客户端
-- 直接把自己插成任意房间的 owner（提权）。角色变更一律走服务端 API（service_role）。
CREATE POLICY "Join as member" ON public.room_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'member');
CREATE POLICY "Update own membership" ON public.room_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND role = 'member');
CREATE POLICY "Leave room" ON public.room_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Service role full room_members" ON public.room_members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. friends RLS
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friends TO authenticated;

CREATE POLICY "Read own friends" ON public.friends FOR SELECT TO authenticated
  USING (user_a = auth.uid() OR user_b = auth.uid());
CREATE POLICY "Manage own friends" ON public.friends FOR ALL TO authenticated
  USING (user_a = auth.uid() OR user_b = auth.uid())
  WITH CHECK (user_a = auth.uid() OR user_b = auth.uid());
CREATE POLICY "Service role full friends" ON public.friends FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. reactions RLS
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reactions TO authenticated;

CREATE POLICY "Read reactions" ON public.reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage own reactions" ON public.reactions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full reactions" ON public.reactions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. push_subscriptions RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

CREATE POLICY "Read own push" ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Manage own push" ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full push_subscriptions" ON public.push_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. message_reads RLS
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reads TO authenticated;

CREATE POLICY "Read own reads" ON public.message_reads FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Manage own reads" ON public.message_reads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full message_reads" ON public.message_reads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. rooms RLS（authenticated 可读全部用于房间发现；创建时 created_by 须为本人；仅创建者可改名）
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.rooms TO authenticated;

-- 只允许读「与我有关」的房间。若放开 USING(true)，任何人拿 publishable key 就能
-- GET /rest/v1/rooms 枚举全部房间；而私聊房间 id 形如 dm:<uuidA>:<uuidB>，
-- 等于直接泄露「谁在跟谁聊」。房间发现统一走服务端 /api/rooms?ids=（service_role）。
CREATE POLICY "Read rooms" ON public.rooms FOR SELECT TO authenticated
  USING (public.is_room_participant(id, auth.uid()));
CREATE POLICY "Create rooms" ON public.rooms FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR id = 'default-room');
CREATE POLICY "Update own rooms" ON public.rooms FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY "Service role full rooms" ON public.rooms FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. get_room_last_messages RPC 改为返回 user_id + user(展示名)
CREATE OR REPLACE FUNCTION public.get_room_last_messages(p_room_ids text[])
RETURNS TABLE (
  room_id   text,
  "timestamp" timestamptz,
  content   text,
  "type"    text,
  user_id   uuid,
  "user"    text
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (m.room_id)
    m.room_id,
    m.timestamp,
    m.content,
    m.type,
    m.user_id,
    m."user"
  FROM public.messages m
  WHERE m.room_id = ANY(p_room_ids)
  ORDER BY m.room_id, m.timestamp DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_room_last_messages(text[]) TO service_role, authenticated, anon;
