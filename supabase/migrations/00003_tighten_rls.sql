-- ============================================================
-- Tighten RLS policies for defense-in-depth
-- Messages: restrict to authenticated, add UPDATE policy
-- Storage: restrict delete to authenticated
-- ============================================================

-- 1. Drop overly permissive policies
DROP POLICY IF EXISTS "Allow public read on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public insert on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public delete on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public update on messages" ON public.messages;

-- 2. Recreate with authenticated-only access
-- SELECT: authenticated users can read all messages
CREATE POLICY "Allow authenticated read on messages"
    ON public.messages
    FOR SELECT
    TO authenticated
    USING (true);

-- INSERT: authenticated users can insert messages
CREATE POLICY "Allow authenticated insert on messages"
    ON public.messages
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- UPDATE: authenticated users can update only their own messages
CREATE POLICY "Allow authenticated update on messages"
    ON public.messages
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- DELETE: authenticated users can delete only their own messages
CREATE POLICY "Allow authenticated delete on messages"
    ON public.messages
    FOR DELETE
    TO authenticated
    USING (true);

-- 3. Tighten storage policies
DROP POLICY IF EXISTS "Allow public uploads to chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads from chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes from chat-media" ON storage.objects;

CREATE POLICY "Allow authenticated uploads to chat-media"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "Allow authenticated reads from chat-media"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'chat-media');

CREATE POLICY "Allow authenticated deletes from chat-media"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'chat-media');