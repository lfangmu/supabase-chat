import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? '';

// This client is used ONLY for Realtime broadcast channels.
// All DB operations (CRUD) and storage uploads go through server-side API routes
// using the Service Role Key, ensuring the anon key cannot access data directly.

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY — Realtime features (live messages, typing indicators) will be disabled.'
  );
}

export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;
