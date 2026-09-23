-- 收紧 anon 写权限（防直连 Supabase 篡改数据）
--
-- 应用鉴权走自定义共享密码 + chat_session JWT，后端 API 路由已改用 service_role key 写库。
-- 此处把 anon 角色的写/改/删策略移除，仅保留 SELECT（实时订阅与公开浏览依赖 anon 读）。
-- service_role 绕过 RLS，写操作照常工作；直连 Supabase 的 anon 请求将被拒绝写入。
--
-- 读策略（以下）保留不动：
--   "Allow public read on rooms"
--   "Allow public read on messages"
--   "Allow public reads from chat-media"

-- rooms: 移除 anon 写/改/删
DROP POLICY IF EXISTS "Allow public insert on rooms" ON public.rooms;
DROP POLICY IF EXISTS "Allow public update on rooms" ON public.rooms;
DROP POLICY IF EXISTS "Allow public delete on rooms" ON public.rooms;

-- messages: 移除 anon 写/改/删
DROP POLICY IF EXISTS "Allow public insert on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public update on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public delete on messages" ON public.messages;

-- storage chat-media: 移除 anon 上传/删除，保留 anon 读
DROP POLICY IF EXISTS "Allow public uploads to chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes from chat-media" ON storage.objects;
