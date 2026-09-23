-- ============================================================
-- Restore PUBLIC (anon) RLS access for the shared-password chat model.
--
-- Background:
--   The app authenticates via its own custom JWT (chat_session cookie,
--   see src/middleware.ts), NOT via Supabase Auth. The edge functions
--   (and the anon browser client used for Realtime) connect with the
--   anon key and therefore always act as the Postgres `anon` role.
--
--   Migration 00003_tighten_rls tightened messages/storage to
--   `TO authenticated` and 00004 created rooms with `TO authenticated`
--   only. Because the app never establishes a Supabase user session,
--   every request is the `anon` role and gets blocked by RLS:
--     - SELECT on rooms  -> filtered to empty (rooms list never loads)
--     - INSERT on rooms  -> rejected (cannot create a group)
--     - messages / storage -> same anon block
--
--   This migration re-adds PUBLIC policies (matching the original 00001
--   design). The custom JWT in middleware remains the real auth gate;
--   Supabase is just a shared datastore for a public chat.
-- ============================================================

-- 1. rooms -----------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read on rooms" ON public.rooms;
CREATE POLICY "Allow public read on rooms"
    ON public.rooms FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert on rooms" ON public.rooms;
CREATE POLICY "Allow public insert on rooms"
    ON public.rooms FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update on rooms" ON public.rooms;
CREATE POLICY "Allow public update on rooms"
    ON public.rooms FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete on rooms" ON public.rooms;
CREATE POLICY "Allow public delete on rooms"
    ON public.rooms FOR DELETE USING (true);

-- 2. messages --------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read on messages" ON public.messages;
CREATE POLICY "Allow public read on messages"
    ON public.messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert on messages" ON public.messages;
CREATE POLICY "Allow public insert on messages"
    ON public.messages FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update on messages" ON public.messages;
CREATE POLICY "Allow public update on messages"
    ON public.messages FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete on messages" ON public.messages;
CREATE POLICY "Allow public delete on messages"
    ON public.messages FOR DELETE USING (true);

-- 3. storage: chat-media bucket -------------------------------------------
DROP POLICY IF EXISTS "Allow public uploads to chat-media" ON storage.objects;
CREATE POLICY "Allow public uploads to chat-media"
    ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "Allow public reads from chat-media" ON storage.objects;
CREATE POLICY "Allow public reads from chat-media"
    ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "Allow public deletes from chat-media" ON storage.objects;
CREATE POLICY "Allow public deletes from chat-media"
    ON storage.objects FOR DELETE USING (bucket_id = 'chat-media');
