import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { MAX_BATCH, MAX_WAIT_S, RATE_LIMIT_PER_MIN } from "@/api/schemas";
import { RETRY_DELAYS_S } from "@/api/webhooks-pg";

export const metadata: Metadata = { title: "API docs" };

const BASE = (process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || "https://your-firstline-address") + "/api/v1";

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100">{children}</pre>;
}
function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-6 text-xl font-semibold text-slate-900">
      {children}
    </h2>
  );
}

export default function ApiDocs() {
  const retry = RETRY_DELAYS_S.map((s) => (s < 3600 ? `${s / 60} min` : `${s / 3600} h`)).join(", ");
  return (
    <div className="mx-auto max-w-3xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <Link href="/">
          <Logo />
        </Link>
        <a href="/api/v1/openapi.json" className="text-sm font-medium text-indigo-700 hover:underline">
          OpenAPI 3.1 file
        </a>
      </header>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">FirstLine API</h1>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-slate-700">
        <p>
          Send a lead and your cold email with <code>[[slots]]</code>. FirstLine reads the company&apos;s website and writes only the slots, citing every fact. Same
          credits as the app: reserved when a job is accepted, charged when a lead is personalised, given back on a fallback.
        </p>

        <H2 id="auth">1. Get an API key</H2>
        <p>
          In the app: <Link href="/settings/api" className="text-indigo-700 hover:underline">Settings → API</Link> → Create key. It starts with <code>fl_live_</code>{" "}
          and is shown once. Send it on every call:
        </p>
        <Code>{`Authorization: Bearer fl_live_…`}</Code>

        <H2 id="quickstart">2. Quickstart</H2>
        <p>Personalise one lead and wait for the result in the same call:</p>
        <Code>{`curl ${BASE}/personalize \\
  -H "Authorization: Bearer $FIRSTLINE_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: lead-123" \\
  -d '{
    "lead": {
      "email": "sanne@bakkerijvos.nl",
      "first_name": "Sanne",
      "company": "Bakkerij Vos",
      "website": "bakkerijvos.nl"
    },
    "copy": {
      "subject": "Idea for {{company}}",
      "body": "Hi {{first_name}},\\n\\n[[opener · something specific from their website · 25]]\\n\\nWe help bakeries cut waste. Worth a call?"
    },
    "wait": 45
  }'`}</Code>
        <p>The answer (shortened):</p>
        <Code>{`{
  "id": "4b1c…", "object": "job", "kind": "single", "status": "done", "credits_used": 1,
  "result": {
    "email": "sanne@bakkerijvos.nl",
    "status": "personalised",
    "subject": "Idea for Bakkerij Vos",
    "email_body": "Hi Sanne,\\n\\nSaw you opened a second shop in Utrecht-Oost…",
    "slots": { "opener": "Saw you opened a second shop in Utrecht-Oost…" },
    "sources": [{ "fact": "Second shop in Utrecht-Oost", "url": "https://bakkerijvos.nl/nieuws" }],
    "confidence": "high",
    "credits_used": 1
  }
}`}</Code>
        <ul>
          <li>
            <code>wait</code> (0–{MAX_WAIT_S} s): wait for the result. Without it, or if it takes longer, you get <code>202</code> with status <code>running</code>: poll{" "}
            <code>GET /jobs/{"{id}"}?wait=30</code> or use a webhook.
          </li>
          <li>
            Use <code>campaign_id</code> instead of <code>copy</code> to use a campaign&apos;s copy from the app.
          </li>
          <li>
            Without <code>website</code>, the company domain of the email address is used (never gmail.com and similar). No usable facts: status{" "}
            <code>fallback</code>, a neutral line, 0 credits.
          </li>
        </ul>

        <H2 id="endpoints">3. Endpoints</H2>
        <ul>
          <li>
            <code>POST /personalize</code>: one lead (<code>lead</code>, <code>copy</code> or <code>campaign_id</code>, <code>options</code>, <code>wait</code>).
          </li>
          <li>
            <code>POST /personalize/batch</code>: up to {MAX_BATCH} leads (<code>leads</code>: […]).
          </li>
          <li>
            <code>GET /jobs/{"{id}"}</code>: a job with <code>results</code> per lead. Optional <code>?wait=</code> seconds.
          </li>
          <li>
            <code>GET /credits</code>: <code>available</code> and <code>reserved</code> credits.
          </li>
        </ul>
        <p>
          <code>options.writer</code>: <code>pro</code> (default) or <code>lite</code>. Deep and Local research are not available in the API yet.
        </p>

        <H2 id="safety">4. Retries, limits and errors</H2>
        <ul>
          <li>
            <strong>Idempotency-Key</strong>: retrying with the same key returns the same job and never charges twice. The same key with a different body gives{" "}
            <code>422</code>.
          </li>
          <li>
            <strong>Rate limit</strong>: {RATE_LIMIT_PER_MIN} requests per minute per key. Over it: <code>429</code> with <code>Retry-After</code> (seconds). Every
            answer has <code>X-RateLimit-Limit</code>, <code>-Remaining</code> and <code>-Reset</code>.
          </li>
          <li>
            Errors are always <code>{`{"error": {"code": "…", "message": "…"}}`}</code>: <code>unauthorized</code> (401), <code>invalid_request</code> (400),{" "}
            <code>insufficient_credits</code> (402), <code>not_found</code> (404), <code>idempotency_conflict</code> (422), <code>rate_limited</code> (429),{" "}
            <code>server_error</code> (500/503: retry with the same Idempotency-Key).
          </li>
        </ul>

        <H2 id="webhooks">5. Webhooks</H2>
        <p>
          Add an https URL in <Link href="/settings/api" className="text-indigo-700 hover:underline">Settings → API</Link>. FirstLine posts{" "}
          <code>job.completed</code> (one lead) or <code>batch.completed</code> with the whole job as <code>data</code>. Any 2xx within 10 seconds counts; otherwise it
          retries after {retry}.
        </p>
        <p>
          Check the signature: header <code>FirstLine-Signature: t=…,v1=…</code>, an HMAC-SHA256 of <code>{"<t>.<raw body>"}</code> with your endpoint secret.
        </p>
        <Code>{`import crypto from "node:crypto";

function verify(secret, rawBody, header) {
  const [, t, sig] = header.match(/t=(\\d+),v1=([0-9a-f]{64})/) ?? [];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}`}</Code>

        <H2 id="nocode">6. n8n and Make</H2>
        <p>
          n8n: install the community node <code>n8n-nodes-firstline</code> (operations: Personalise lead, Get job, Get credits). Make: the FirstLine app with the same
          three modules. Both use an API key from Settings → API.
        </p>

        <H2 id="data">7. Data</H2>
        <p>
          Leads sent through the API are processed like campaign leads under our <Link href="/dpa" className="text-indigo-700 hover:underline">DPA</Link> and deleted 30
          days after the job finishes. Webhook deliveries are deleted after 30 days too.
        </p>
      </div>
    </div>
  );
}
