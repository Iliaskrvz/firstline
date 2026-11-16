// POST /api/contact: "Talk to us" on /agencies. Stores the request and emails the owner.
// Protection: hidden honeypot field, Turnstile when its keys are set, 3 per IP and 50 in total per day.
// Without Resend the request is still stored and shown on /admin.
import { NextResponse, type NextRequest } from "next/server";
import { hashIp } from "@/engine/demo-pg";
import { admitContact, contactNotification, markContactNotified, parseContact, type ContactField } from "@/lib/contact";
import { verifyTurnstile } from "@/lib/turnstile";
import { resendMailer } from "@/sender/alerts";
import { serverPool } from "@/server/db";
import { AGENCIES } from "@/content/agencies";

const M = AGENCIES.form.errors;
const fieldError: Record<ContactField, string> = { name: M.name, email: M.email, volume: M.volume, company: M.generic, message: M.generic };
const err = (status: number, error: string, field?: string) => NextResponse.json({ error, field }, { status });

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err(400, M.generic);
  }
  const parsed = parseContact(body);
  if (!parsed.ok) {
    if (parsed.spam) return NextResponse.json({ ok: true }); // bots get a normal answer and nothing is stored
    return err(400, parsed.field ? fieldError[parsed.field] : M.generic, parsed.field ?? undefined);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (secret && process.env.TURNSTILE_SITE_KEY?.trim()) {
    const ok = await verifyTurnstile(typeof body.token === "string" ? body.token : "", ip === "unknown" ? null : ip, secret);
    if (!ok) return err(403, M.captcha);
  }

  const pool = serverPool();
  const salt = process.env.DEMO_IP_SALT?.trim() || process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim() || "firstline-demo";
  const admit = await admitContact(pool, { ...parsed.value, ipHash: hashIp(ip, salt) });
  if (!admit.ok) return err(429, admit.reason === "ip_limit" ? M.ipLimit : M.dailyCap);

  const key = process.env.RESEND_API_KEY?.trim();
  const to = process.env.CONTACT_TO_EMAIL?.trim() || process.env.LEGAL_EMAIL?.trim();
  if (key && to) {
    try {
      const mail = resendMailer(key, process.env.ALERT_FROM_EMAIL?.trim() || "FirstLine <onboarding@resend.dev>");
      await mail.send({ to, replyTo: parsed.value.email, ...contactNotification(parsed.value, process.env.PUBLIC_APP_URL?.trim() || null) });
      await markContactNotified(pool, admit.id);
    } catch (e) {
      // Stored anyway; it shows on /admin without the "emailed" mark.
      console.error("contact notification failed", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true });
}
