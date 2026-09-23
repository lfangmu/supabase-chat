-- ============================================================
-- Round 4 — 撤销 anon(匿名) 只读策略，补齐 defense-in-depth
--
-- 背景：
--   * 应用鉴权走自定义 JWT(chat_session cookie) + 后端 API 路由，
--     所有 DB 读取 / 写入都通过服务端 API，且已统一改用
--     service_role key(绕过 RLS)。
--   * 浏览器侧 anon client 仅用于 Realtime 的 broadcast 通道，
--     不使用 postgres_changes，因此不需要任何表级 SELECT 权限。
--   * anon key 随前端包发往浏览器，任何人都能拿它直接连 Supabase
--     读取全部 messages/rooms/users 等数据，绕过 API 层鉴权。
--     撤销 anon SELECT 后，即使有人直连也只能拿到空结果。
--
-- 注意：
--   * service_role 角色绕过 RLS，服务端读取/写入照常工作。
--   * Realtime 为 broadcast-only，不依赖表级 SELECT，实时消息不受影响。
-- ============================================================

-- 1. rooms: 撤销 anon 只读(写/改/删已在 00012 移除) ----------------------
DROP POLICY IF EXISTS "Allow public read on rooms" ON public.rooms;

-- 2. messages: 撤销 anon 只读(写/改/删已在 00012 移除) ------------------
DROP POLICY IF EXISTS "Allow public read on messages" ON public.messages;

-- 3. storage: 撤销 chat-media 的 anon 只读(上传/删除已在 00012 移除) ----
DROP POLICY IF EXISTS "Allow public reads from chat-media" ON storage.objects;

-- 4. wechat 功能表(anon, authenticated 都不再是直连路径) ----------------
DROP POLICY IF EXISTS "Allow read users"         ON public.users;
DROP POLICY IF EXISTS "Allow read friends"       ON public.friends;
DROP POLICY IF EXISTS "Allow read room_members"  ON public.room_members;
DROP POLICY IF EXISTS "Allow read message_reads" ON public.message_reads;
