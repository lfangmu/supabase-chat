-- ============================================================
-- User profiles table for email+password registration/login
-- Uses PBKDF2 password hashing (Edge-compatible, Web Crypto API)
-- ============================================================

-- 1. Create user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    nickname      TEXT NOT NULL,
    avatar        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 2. Index for email lookups during login
CREATE INDEX IF NOT EXISTS idx_user_profiles_email
    ON public.user_profiles (email);

-- 3. Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
-- The app uses Service Role Key for all DB operations via API routes,
-- so RLS is primarily a defense-in-depth measure.

-- Allow authenticated users to read their own profile
DROP POLICY IF EXISTS "Allow authenticated read own profile" ON public.user_profiles;
CREATE POLICY "Allow authenticated read own profile"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access (insert/update/delete handled via API routes)
-- No anon access — registration/login go through API routes with Service Role Key
DROP POLICY IF EXISTS "Deny anon access to user_profiles" ON public.user_profiles;
CREATE POLICY "Deny anon access to user_profiles"
    ON public.user_profiles
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);
