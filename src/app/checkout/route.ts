// GET /checkout?products=<Dodo product id>: start a Dodo hosted checkout and send the visitor there.
// For links outside the Credits page. Buying is for workspace owners and admins; the current workspace
// is the paying customer, so a successful payment for a pack product credits that workspace.
import { NextResponse, type NextRequest } from "next/server";
import { createLinkCheckout, parseProductIds } from "@/billing/dodo";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { publicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { dodoCheckouts, dodoConfigured } from "@/server/dodo";

export async function GET(request: NextRequest) {
  const products = parseProductIds(request.nextUrl.searchParams.getAll("products"));
  if (!products) return NextResponse.json({ error: "Add ?products=<Dodo product id>." }, { status: 400 });
  if (!dodoConfigured()) return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });

  const origin = publicOrigin(request.headers, process.env.PUBLIC_APP_URL?.trim() || request.nextUrl.origin);
  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims?.sub) {
    const login = new URL("/login", origin);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login, 302);
  }
  const w = await requireWorkspaceAdmin();
  if (!w.ok) return NextResponse.json({ error: "Only the workspace owner or an admin can buy credits." }, { status: 403 });

  try {
    const url = await createLinkCheckout(dodoCheckouts(origin), { products, workspaceId: w.workspace.id, origin, email: (data.claims.email as string | undefined) ?? null });
    return NextResponse.redirect(url, 302);
  } catch (e) {
    console.error("dodo checkout:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't start the checkout. Try again in a minute." }, { status: 502 });
  }
}
