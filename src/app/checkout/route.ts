// GET /checkout?products=<polar product id>: start a Polar hosted checkout and send the visitor there.
// Polar shows its own confirmation after payment (no success URL). A signed-in user is passed as the
// external customer id, so the webhook can find them again.
import { NextResponse, type NextRequest } from "next/server";
import { createPolarCheckout, parseProductIds } from "@/billing/polar";
import { publicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { polarCheckouts, polarConfigured } from "@/server/polar";

export async function GET(request: NextRequest) {
  const products = parseProductIds(request.nextUrl.searchParams.getAll("products"));
  if (!products) return NextResponse.json({ error: "Add ?products=<Polar product id>." }, { status: 400 });
  if (!polarConfigured()) return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });

  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const origin = publicOrigin(request.headers, process.env.PUBLIC_APP_URL?.trim() || request.nextUrl.origin);
  try {
    const url = await createPolarCheckout(polarCheckouts(origin), {
      products,
      userId: claims?.sub ?? null,
      email: (claims?.email as string | undefined) ?? null,
      ip,
    });
    return NextResponse.redirect(url, 302);
  } catch (e) {
    console.error("polar checkout:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't start the checkout. Try again in a minute." }, { status: 502 });
  }
}
