-- 00008_rooms_extension.sql
-- REQ-006: pinned_message_id column
-- REQ-008: type column (public/dm)

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS pinned_message_id TEXT;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'public'
    CHECK (type IN ('public', 'dm'));
