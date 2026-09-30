-- 00023_harden_room_members_rls.sql
--
-- 修复 CODE-REVIEW-2026-09-28.md P0-2 的「放大点」：
--   supabase/migrations/00021_rls_uuid.sql:115
--     CREATE POLICY "Read room_members" ON public.room_members FOR SELECT TO authenticated USING (true);
--
-- 问题现象：
--   任何 `authenticated` 用户都能执行
--     GET /api/rest/v1/room_members?select=room_id
--   拿到**全站所有房间 id**。配合 GET /api/rooms?ids=<全部 id> 可一次性拖走
--   每个群的名称、创建者、以及最新一条消息正文（该路由用 service_role 调 RPC，绕过 RLS）。
--   （`/api/rooms?ids=` 自身的全类型参与校验已在应用层修复，本迁移消除「房间 id 可枚举」
--     这一前提，形成纵深防御。）
--
-- 修复后预期结果：
--   authenticated 只能读到「自己所在房间的成员行」+「自己创建的房间的成员行」+「自己那一行」。
--   无法再枚举全站房间 id；`room_members` 的 RLS 与 `rooms` / `messages` 的
--   `is_room_participant` 语义保持一致。
--
-- 注意：策略体里**不能**直接子查询 `room_members` 自身 —— Postgres RLS 会无限递归。
--   因此通过 SECURITY DEFINER 函数（以函数所有者身份执行，绕过 RLS）来做判定。
--   这与 00019 / 00021 中 `is_room_participant` 的既有做法一致。

-- 1. 递归安全的判定函数（SECURITY DEFINER + 固定 search_path 防搜索路径注入）
CREATE OR REPLACE FUNCTION public.can_view_room_members(p_room text, p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.room_members
           WHERE room_id = p_room AND user_id = p_actor
         )
      OR EXISTS (
           SELECT 1 FROM public.rooms
           WHERE id = p_room AND created_by = p_actor
         );
$$;

COMMENT ON FUNCTION public.can_view_room_members(text, uuid) IS
  'RLS 辅助：p_actor 是否为 p_room 的成员或创建者。SECURITY DEFINER，避免 room_members 策略自引用递归。';

-- 2. 收紧 SELECT 策略：从 USING (true) 改为「本人行 / 本人所在房间的行」
DROP POLICY IF EXISTS "Read room_members" ON public.room_members;
CREATE POLICY "Read own room memberships" ON public.room_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_view_room_members(room_id, auth.uid())
  );

-- 3. 保留「以 member 身份加入自己」的 INSERT 策略语义不变（仅重命名以消除歧义）
DROP POLICY IF EXISTS "Join as member" ON public.room_members;
CREATE POLICY "Join as member" ON public.room_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'member');

-- 4. 兼容历史：旧策略名 "Update own membership" / "Leave room" 保持不变（未涉及本次缺陷）。
--    service_role 策略保持不变（服务端 API 走 service_role，不受影响）。
