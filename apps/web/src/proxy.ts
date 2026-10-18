import { NextResponse, type NextRequest } from 'next/server';

// Better Auth session cookie (cookiePrefix "madar"; "__Secure-" prefix over HTTPS in production).
const SESSION_COOKIES = ['madar.session_token', '__Secure-madar.session_token'];

/**
 * Sends visitors without a session cookie to /login. This is a convenience redirect only:
 * the API checks every request. Stale cookies are handled by the app gate (401 → /login).
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = '/login';
  url.search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except auth pages, public pages, API, Next internals and static files.
  matcher: [
    '/((?!login|signup|status|design-system|api|_next/static|_next/image|fonts|icons|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|sw\\.js|favicon\\.ico|robots\\.txt).*)',
  ],
};
