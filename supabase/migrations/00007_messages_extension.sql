-- 00007_messages_extension.sql
-- REQ-002: link_preview JSONB column
-- REQ-010: file metadata columns + type CHECK extension
-- REQ-011: forwarded_from JSONB column
-- REQ-003: search helper indexes

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS link_preview JSONB;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_mime TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS forwarded_from JSONB;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'voice', 'file'));

CREATE INDEX IF NOT EXISTS idx_messages_user ON public.messages ("user");
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages (timestamp DESC);
