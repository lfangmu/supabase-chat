-- 00006_reactions.sql
-- REQ-001: Emoji Reactions table

CREATE TABLE IF NOT EXISTS public.reactions (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    "user"      TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, "user", emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON public.reactions (message_id);

ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read on reactions"
    ON public.reactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert on reactions"
    ON public.reactions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on reactions"
    ON public.reactions FOR DELETE TO authenticated USING (true);
