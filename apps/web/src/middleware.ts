import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && path.startsWith('/app')) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    return NextResponse.redirect(login);
  }

  if (user && (path === '/login' || path === '/signup')) {
    const app = request.nextUrl.clone();
    app.pathname = '/app/rules';
    return NextResponse.redirect(app);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Exclude Next internals, static assets, and Phase 4 execute surface.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/v1/execute|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
