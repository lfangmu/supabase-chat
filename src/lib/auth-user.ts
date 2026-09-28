import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabase } from './supabase-server';

export interface AuthIdentity {
  id: string;
  email: string | null;
}

/**
 * Resolve the current user's Supabase Auth UUID from a request.
 * Returns null when unauthenticated or the session is invalid.
 *
 * Replaces the old `getSessionUser(cookieHeader)` which resolved a *nickname*.
 * After the Supabase Auth migration, `actor` everywhere is a real UUID that
 * matches the `auth.uid()`-keyed identity columns in the database.
 */
export async function getAuthUser(request: Request): Promise<string | null> {
  const supabase = createServerSupabase(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/** Same as {@link getAuthUser} but also returns the auth email (may be null for anon). */
export async function getAuthIdentity(request: Request): Promise<AuthIdentity | null> {
  const supabase = createServerSupabase(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Look up a user's display name (profile) by UUID using a *service-role*
 * client (bypasses RLS). Returns null if no profile row exists yet.
 *
 * Pass the client from `getServiceClient()` (src/lib/service-client.ts).
 */
export async function getDisplayName(
  serviceClient: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('users')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.display_name;
}
