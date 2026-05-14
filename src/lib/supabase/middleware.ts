import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PROTECTED_PREFIXES = ["/app"];
const AUTH_REDIRECT_FROM_AUTHENTICATED = ["/login"];
// Phase 5a admin route gate (architect doc §4.6): worker は /app/admin/* と
// /app/admin/users/* に到達不可。/app/correct/* と /app/account/* は worker
// でも到達可 (self-record correction / personal settings)。
const ADMIN_ONLY_PREFIXES = ["/app/admin"];
// Phase 6f-5 (architect §E.4): /app/admin/tenants is system_admin only.
// tenant_admin attempts redirect to /app/admin (admin index) with notice.
const SYSTEM_ADMIN_ONLY_PREFIXES = ["/app/admin/tenants"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isProtected(pathname: string): boolean {
  return matchesPrefix(pathname, PROTECTED_PREFIXES);
}

function isAuthRoute(pathname: string): boolean {
  return matchesPrefix(pathname, AUTH_REDIRECT_FROM_AUTHENTICATED);
}

function isAdminOnly(pathname: string): boolean {
  return matchesPrefix(pathname, ADMIN_ONLY_PREFIXES);
}

function isSystemAdminOnly(pathname: string): boolean {
  return matchesPrefix(pathname, SYSTEM_ADMIN_ONLY_PREFIXES);
}

type AppRole = "worker" | "tenant_admin" | "system_admin";

function readRoleClaim(meta: Record<string, unknown> | null | undefined): AppRole {
  if (!meta) return "worker";
  const v = meta["role"];
  if (v === "tenant_admin" || v === "system_admin") return v;
  return "worker";
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
  if (user && isAdminOnly(pathname)) {
    const role = readRoleClaim(user.app_metadata as Record<string, unknown> | null);
    if (role === "worker") {
      const url = request.nextUrl.clone();
      url.pathname = "/app/logi";
      url.search = "";
      return NextResponse.redirect(url);
    }
    // Phase 6f: tenant_admin が /app/admin/tenants へ来た場合は admin index に
    // ソフト戻し (system_admin only)。
    if (role === "tenant_admin" && isSystemAdminOnly(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/app/admin";
      url.search = "";
      url.searchParams.set("notice", "system-admin-only");
      return NextResponse.redirect(url);
    }
  }

  return response;
}
