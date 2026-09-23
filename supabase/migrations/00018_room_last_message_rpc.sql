-- 00018_room_last_message_rpc.sql
-- 修复群列表 last_message 取数不准：此前用 messages 全局 timestamp desc limit 200
-- 取「最新消息」，导致多房间时大部分房间因活跃群挤占 top200 而拿不到 last_message_at，
-- 列表排序/未读角标失真。改为按 room_id 分组取各自最新一条
-- （DISTINCT ON + 已有索引 idx_messages_room_timestamp(room_id, timestamp DESC)），
-- 一次索引查询替代全表扫描，每个房间都能稳定拿到自身最新一条。
CREATE OR REPLACE FUNCTION public.get_room_last_messages(p_room_ids text[])
RETURNS TABLE (
  room_id   text,
  "timestamp" timestamptz,
  content   text,
  "type"    text,
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
    m."user"
  FROM public.messages m
  WHERE m.room_id = ANY(p_room_ids)
  ORDER BY m.room_id, m.timestamp DESC;
$$;

-- 防御性授权（Supabase 默认 PUBLIC 已可 EXECUTE；此处显式声明确保各角色均可调用）
GRANT EXECUTE ON FUNCTION public.get_room_last_messages(text[]) TO service_role, authenticated, anon;
