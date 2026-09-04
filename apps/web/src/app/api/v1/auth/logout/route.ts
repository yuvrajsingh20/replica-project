import { NextResponse } from 'next/server';
import { createClient } from '../../../../../lib/supabase/server.js';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', new URL(request.url).origin), {
    status: 303,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
