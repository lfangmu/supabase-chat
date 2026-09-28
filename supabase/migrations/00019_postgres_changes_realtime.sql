-- ============================================================
-- Round 5 — 实时投递：从「签名广播」切换到「Postgres Changes (CDC) + RLS」
--
-- 背景：
--   * 旧方案：API 落库后由 Edge Function（broadcast-message）用 Ed25519 私钥签名，
--     把消息广播到 chat-room:<room_id> 频道；前端校验签名防伪造。需维护
--     BROADCAST_SIGNING_KEY / NEXT_PUBLIC_BROADCAST_VERIFY_KEY 两把密钥 + 密钥生成脚本，
--     部署繁琐，且广播通道不受 RLS 约束（只能靠签名防注入）。
--   * 新方案：浏览器实时客户端以 authenticated 身份订阅 messages 表的 INSERT
--     (postgres_changes)，由数据库实时发布（binlog 等价物）直接推送完整行。
--     - 只有「经服务端 API 鉴权落库」的行才会被发布 → 天然防伪造（无法伪造消息）。
--     - RLS 按「房间成员」过滤 → 非成员收不到，等价于原广播的房间隔离。
--     - 零密钥：不再需要 Ed25519 签名对。
--
-- 前提（本迁移负责）：
--   1. messages 加入 supabase_realtime 发布（postgres_changes 只对发布内表生效）。
--   2. 提供房间成员判定函数 + authenticated 只读策略（撤销 00016 撤销的 anon 读取）。
--
-- 客户端配套（代码侧）：
--   * src/lib/supabase.ts 的客户端通过 /api/realtime-token 取得由 SUPABASE_JWT_SECRET
--     签发的 authenticated JWT，作为 postgres_changes 的身份。
--   * src/hooks/useMessageRealtime.ts 把 chat-message 的 broadcast 监听换成 postgres_changes。
-- ============================================================

-- 1. 把 messages 加入实时发布 -------------------------------------------------
-- 没有这步，postgres_changes 不会触发（默认发布不包含应用表）。
-- 幂等保护：若该表已在发布内（例如此前半途失败的重试），不再 ADD，避免
-- "relation already member of publication" 报错中止整批迁移。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- 2. 房间成员判定函数（与 TS 版 isRoomParticipant 逻辑一致）-------------------
--   SECURITY DEFINER：以所有者身份读取 rooms / room_members，不受调用者 RLS 影响，
--   同时避免 RLS 递归。务必 SET search_path 防止搜索路径注入。
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room text, p_actor text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by text;
  v_member    text;
BEGIN
  IF p_room IS NULL OR p_actor IS NULL THEN
    RETURN false;
  END IF;

  -- 全局公共大厅：任何已登录用户可读
  IF p_room = 'default-room' THEN
    RETURN true;
  END IF;

  -- 私聊房间：dm:A:B —— actor 须为其中一方参与者
  IF p_room LIKE 'dm:%' THEN
    RETURN p_actor = ANY (string_to_array(split_part(p_room, 'dm:', 2), ':'));
  END IF;

  -- 普通群：创建者 或 成员行存在
  SELECT created_by INTO v_created_by
  FROM rooms WHERE id = p_room;
  IF FOUND AND v_created_by = p_actor THEN
    RETURN true;
  END IF;

  SELECT "user" INTO v_member
  FROM room_members WHERE room_id = p_room AND "user" = p_actor LIMIT 1;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_room_participant(text, text) TO authenticated, anon;

-- 3. 撤销旧的 anon 只读策略（防御性，确保无残留的匿名读取路径）----------------
DROP POLICY IF EXISTS "Allow public read on messages" ON public.messages;

-- 4. 授予 authenticated 角色 SELECT，并按房间成员过滤 --------------------------
GRANT SELECT ON public.messages TO authenticated;

DROP POLICY IF EXISTS "Authenticated members can read messages" ON public.messages;
CREATE POLICY "Authenticated members can read messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (public.is_room_participant(room_id, auth.uid()::text));

-- 5. 收敛写入路径：移除遗留的 anon/authenticated 直写策略 ----------------------
--   所有写入只走服务端 API（使用 service_role key 绕过 RLS），不再允许匿名/已登录
--   客户端直连 PostgREST 写入。与本项目「DB 写入统一经服务端」的设计一致。
DROP POLICY IF EXISTS "Allow public insert on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public update on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public delete on messages" ON public.messages;
