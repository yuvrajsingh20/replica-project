import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server.js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL('/app/rules', url.origin));
}
