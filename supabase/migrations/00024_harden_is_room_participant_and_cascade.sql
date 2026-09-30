-- 00024_harden_is_room_participant_and_cascade.sql
--
-- 修复 CODE-REVIEW-2026-09-28.md 的两条：
--   P1-4  `customId` 未校验即可作为 DM 房间主键 → `::uuid[]` 抛异常
--   P2-13 删除群聊不清理 room_members → 孤儿行（应用层已修，这里补数据库级兜底）
--
-- ---------------------------------------------------------------------------
-- P1-4
-- 问题现象（supabase/migrations/00021_rls_uuid.sql:59）：
--     RETURN p_actor = ANY (string_to_array(split_part(p_room, 'dm:', 2), ':')::uuid[]);
--   房间号为 `dm:abc:def`（非 UUID）时，`::uuid[]` 直接**抛异常**。
--   该函数被 `messages` / `rooms` 的 RLS 策略调用，因此任何触及该行的 SELECT 会整体报错——
--   对「authenticated 直读 rooms」的客户端即为可用性故障。
--   而应用层 `POST /api/rooms` 曾把请求体的 `customId` 原样当主键（已在 00024 配套的应用层修复中
--   强制校验为规范 `dm:<uuid>:<uuid>`）。
--
-- 修复后预期结果：
--   `is_room_participant()` 对任何畸形房间号都**返回 false 而非抛异常**；
--   恶意/脏数据房间号不再能让整个查询链失败。
-- ---------------------------------------------------------------------------

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
    BEGIN
      -- P1-4：先做严格格式断言，只有 `dm:<uuid>:<uuid>` 才走 `::uuid[]` 转换。
      -- 任何其他形态（`dm:abc:def`、`dm:`、超长等）一律视为「非参与者」，绝不抛异常。
      IF p_room ~ '^dm:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN p_actor = ANY (string_to_array(split_part(p_room, 'dm:', 2), ':')::uuid[]);
      END IF;
    EXCEPTION WHEN others THEN
      -- 兜底：即使将来格式与转换规则再次出现缝隙，也只降级为 false
      RETURN false;
    END;
    RETURN false;
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

-- ---------------------------------------------------------------------------
-- P2-13（数据库级兜底）
-- 问题现象：`rooms` 行被删除后，`room_members` 仍保留该 room_id 的成员行 →
--   `/api/rooms/mine`（从 room_members 出发）仍会列出已删除的房间，
--   前端 `reconcileMyRooms` 据此把幽灵房间反复加回侧边栏。
-- 应用层已在 `DELETE /api/rooms`、`DELETE /api/admin/rooms`、
-- `/api/rooms/members`（群主退群且群空）三处显式清理成员行；
-- 这里再加外键 ON DELETE CASCADE，使任何删除路径（含直接 SQL / 未来新增接口）都不会留下孤儿行。
--
-- 修复后预期结果：删除 rooms 行时数据库自动删除其 room_members 行，孤儿行不可能存在。
-- ---------------------------------------------------------------------------

-- 先清理历史孤儿行，否则加外键会失败
DELETE FROM public.room_members m
WHERE NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = m.room_id);

-- 仅在不存在同名约束时添加（迁移可重复执行）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_members_room_id_fkey'
      AND conrelid = 'public.room_members'::regclass
  ) THEN
    ALTER TABLE public.room_members
      ADD CONSTRAINT room_members_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON public.room_members (room_id);
