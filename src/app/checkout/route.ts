// GET /checkout?products=<polar product id>: start a Polar hosted checkout and send the visitor there.
// For links outside the Credits page. Buying is for workspace owners and admins; the current workspace
// is the paying customer, so a paid order for a pack product credits that workspace. Polar shows its
// own confirmation after payment (no success URL).
import { NextResponse, type NextRequest } from "next/server";
import { createPolarCheckout, parseProductIds } from "@/billing/polar";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { publicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { polarCheckouts, polarConfigured } from "@/server/polar";

export async function GET(request: NextRequest) {
  const products = parseProductIds(request.nextUrl.searchParams.getAll("products"));
  if (!products) return NextResponse.json({ error: "Add ?products=<Polar product id>." }, { status: 400 });
  if (!polarConfigured()) return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });

  const origin = publicOrigin(request.headers, process.env.PUBLIC_APP_URL?.trim() || request.nextUrl.origin);
  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims?.sub) {
    const login = new URL("/login", origin);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login, 302);
  }
  const w = await requireWorkspaceAdmin();
  if (!w.ok) return NextResponse.json({ error: "Only the workspace owner or an admin can buy credits." }, { status: 403 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  try {
    const url = await createPolarCheckout(polarCheckouts(origin), {
      products,
      workspaceId: w.workspace.id,
      email: (data.claims.email as string | undefined) ?? null,
      ip,
    });
    return NextResponse.redirect(url, 302);
  } catch (e) {
    console.error("polar checkout:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't start the checkout. Try again in a minute." }, { status: 502 });
  }
}
