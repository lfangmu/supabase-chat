-- ============================================================
-- Multi-room support: rooms table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for listing rooms
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON public.rooms (created_at DESC);

-- Enable RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all rooms
CREATE POLICY "Allow authenticated read on rooms"
    ON public.rooms
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to create rooms
CREATE POLICY "Allow authenticated insert on rooms"
    ON public.rooms
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Seed the default room
INSERT INTO public.rooms (id, name, created_by)
VALUES ('default-room', '默认聊天室', 'system')
ON CONFLICT (id) DO NOTHING;