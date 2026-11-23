import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only (cookie present?). Real authentication + permission checks happen in the data layer
// (src/server/auth/guard.ts) on every page and action, because a proxy check alone is not authorization.
const ADMIN_COOKIE = "__Host-ikx_admin";
const CUSTOMER_COOKIE = "__Host-ikx_session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && !req.cookies.has(ADMIN_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/account") && !req.cookies.has(CUSTOMER_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  if (pathname.startsWith("/account") || pathname.startsWith("/api/account") || pathname === "/login") res.headers.set("Cache-Control", "private, no-store");
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    res.headers.set("Cache-Control", "no-store"); // never cache staff pages or data in shared caches
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/account/:path*", "/api/account/:path*", "/login"] };
