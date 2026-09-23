-- ============================================================
-- Initial schema for supabase-chat
-- Messages table, indexes, RLS policies, and storage bucket setup
-- ============================================================

-- 1. Create messages table
CREATE TABLE IF NOT EXISTS public.messages (
    id          TEXT PRIMARY KEY,
    room_id     TEXT NOT NULL,
    "user"      TEXT NOT NULL,          -- "user" is a reserved word in PostgreSQL
    type        TEXT NOT NULL CHECK (type IN ('text', 'image', 'video', 'voice')),
    content     TEXT NOT NULL,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quote_id    TEXT,                   -- referenced message id (optional)
    quote       JSONB,                  -- cached quote preview: { user, type, content }
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp
    ON public.messages (room_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_messages_room_created
    ON public.messages (room_id, created_at DESC);

-- 3. Enable Row Level Security on messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies: open access (app-level auth via httpOnly JWT cookie)
DROP POLICY IF EXISTS "Allow public read on messages" ON public.messages;
CREATE POLICY "Allow public read on messages"
    ON public.messages
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow public insert on messages" ON public.messages;
CREATE POLICY "Allow public insert on messages"
    ON public.messages
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete on messages" ON public.messages;
CREATE POLICY "Allow public delete on messages"
    ON public.messages
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- 5. Create storage bucket for media files
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage RLS policies for chat-media bucket
DROP POLICY IF EXISTS "Allow public uploads to chat-media" ON storage.objects;
CREATE POLICY "Allow public uploads to chat-media"
    ON storage.objects
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "Allow public reads from chat-media" ON storage.objects;
CREATE POLICY "Allow public reads from chat-media"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "Allow public deletes from chat-media" ON storage.objects;
CREATE POLICY "Allow public deletes from chat-media"
    ON storage.objects
    FOR DELETE
    TO anon, authenticated
    USING (bucket_id = 'chat-media');
