import { createClient as createSupabaseClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error('admin client is server-only');
}

/** Trigger repair / seeds only — service_role bypasses RLS. Never use in route handlers. */
export function createAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRole = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createSupabaseClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
