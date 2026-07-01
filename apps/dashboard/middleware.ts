import { type NextRequest, NextResponse } from "next/server";
import {
  dashboardTestSessionCookie,
  hasStaffAllowlist,
  hasSupabaseAuthConfig,
  isStaffEmail,
  normaliseNextPath,
  readDashboardAuthConfig,
  verifyDashboardTestSession,
} from "./lib/auth";

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return noStore(NextResponse.next());
  }

  const config = readDashboardAuthConfig();
  const testEmail = await verifyDashboardTestSession(
    request.cookies.get(dashboardTestSessionCookie)?.value,
    config,
  );
  if (isStaffEmail(testEmail, config)) {
    return noStore(NextResponse.next());
  }

  if (!hasStaffAllowlist(config) || !hasSupabaseAuthConfig(config)) {
    return deny(request);
  }

  const { createServerClient } = await import("@supabase/ssr");
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
          }
          response = NextResponse.next({ request });
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !isStaffEmail(data.user.email, config)) {
    return deny(request);
  }

  return noStore(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

function isPublicPath(pathname: string): boolean {
  return pathname === "/login";
}

function deny(request: NextRequest): NextResponse {
  if (request.method === "GET" || request.method === "HEAD") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      normaliseNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    return noStore(NextResponse.redirect(loginUrl));
  }

  return noStore(
    NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    ),
  );
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
