-- 00009_push_subscriptions.sql
-- REQ-009: Web Push subscriptions table

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id          TEXT PRIMARY KEY,
    "user"      TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE("user", endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions ("user");

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated all on push_subscriptions"
    ON public.push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
