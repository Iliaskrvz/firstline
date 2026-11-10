import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(publicUrl(request.headers, request.nextUrl.origin, "/login"), { status: 303 });
}
