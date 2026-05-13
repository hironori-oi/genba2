import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

/**
 * Supabase Auth callback. Handles:
 *  - OAuth / magic-link code exchange (`?code=...`)
 *  - Password recovery redirect (`?type=recovery`) — forwarded to a future
 *    /reset-password page; for Phase 1 we just land them in the app shell
 *    with a notice. The actual password update form is Phase 5 scope.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeInternalPath(searchParams.get("next"));
  const type = searchParams.get("type");

  if (!supabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login?notice=supabase-unconfigured`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?notice=auth-error`);
    }
  }

  if (type === "recovery") {
    // Phase 1: app shell will surface a banner prompting password update once
    // /app/account/password is shipped (Phase 5).
    return NextResponse.redirect(`${origin}/app?notice=recovery`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
