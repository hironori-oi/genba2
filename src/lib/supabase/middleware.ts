import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PROTECTED_PREFIXES = ["/app"];
const AUTH_REDIRECT_FROM_AUTHENTICATED = ["/login"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_REDIRECT_FROM_AUTHENTICATED.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });
  const cfg = getPublicSupabaseConfig();

  // If Supabase env is not yet provided by the owner, allow all routes — the
  // protected pages will render a graceful "auth unavailable" banner instead
  // of redirect-looping. This keeps Phase 1 local build/test feasible.
  if (!cfg) {
    if (isProtected(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("notice", "supabase-unconfigured");
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (user && isAuthRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  return response;
}
