import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/public-origin";
import { supabaseEnv } from "./env";

const PROTECTED = ["/campaigns", "/templates", "/inboxes", "/replies", "/credits", "/admin", "/integrations"];

/** Refreshes the auth session on every request and guards app routes. */
export async function updateSession(request: NextRequest) {
  // If Supabase falls back to the Site URL, the auth code lands on "/". Forward it.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    return NextResponse.redirect(publicUrl(request.headers, request.nextUrl.origin, `/auth/callback${request.nextUrl.search}`));
  }

  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Don't put code between createServerClient and getClaims (session refresh).
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  const path = request.nextUrl.pathname;

  const redirectTo = (to: string) => {
    const target = publicUrl(request.headers, request.nextUrl.origin, to);
    if (to === "/login") target.searchParams.set("next", path);
    const res = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) return redirectTo("/login");
  if (signedIn && (path === "/login" || path === "/")) return redirectTo("/campaigns");

  return response;
}
