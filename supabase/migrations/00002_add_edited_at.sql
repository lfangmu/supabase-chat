-- Add edited_at column for message editing support
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- Add update policy
DROP POLICY IF EXISTS "Allow public update on messages" ON public.messages;
CREATE POLICY "Allow public update on messages"
    ON public.messages
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
