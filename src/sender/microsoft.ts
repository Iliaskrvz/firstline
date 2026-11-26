// Microsoft 365 (Outlook) for the sending lane: sign-in URLs, tokens, and the Graph mail calls we need.
// Checked against learn.microsoft.com on 2026-11-26 (identity platform auth-code flow, admin consent,
// refresh tokens, Graph sendMail / reply / message delta, Mail.ReadBasic, throttling).
//
// Permissions (delegated, least privilege): openid, offline_access, User.Read, Mail.Send, Mail.ReadBasic.
// Mail.ReadBasic reads message properties but never bodies, previews or attachments: FirstLine sees who
// wrote, the subject, the conversation and the time. Nothing else. No Mail.Read, no Mail.ReadWrite.
//
// Framework-free: fetch is passed in, so tests use recorded responses and the fake in microsoft-fake.ts.
import { createHash, randomBytes } from "node:crypto";
import { HttpError, parseRetryAfter } from "@/engine/retry";

export const MS_AUTHORITY = "https://login.microsoftonline.com";
export const GRAPH = "https://graph.microsoft.com/v1.0";
/** Work and school accounts only (no personal outlook.com / hotmail.com). */
export const MS_TENANT = "organizations";
export const MS_SCOPES = ["openid", "offline_access", "User.Read", "Mail.Send", "Mail.ReadBasic"] as const;
/** Scopes that must actually be granted before an inbox counts as connected. */
export const MS_REQUIRED = ["Mail.Send", "Mail.ReadBasic"] as const;
/** Our own header on every email, so we can find it again in Sent Items. */
export const SEND_ID_HEADER = "x-firstline-send-id";

// ---- Sign-in -------------------------------------------------------------------------------------

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Step 1 of the auth-code flow (with PKCE, recommended for confidential clients too). */
export function authorizeUrl(i: { clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | null }): string {
  const u = new URL(`${MS_AUTHORITY}/${MS_TENANT}/oauth2/v2.0/authorize`);
  u.searchParams.set("client_id", i.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", i.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MS_SCOPES.join(" "));
  u.searchParams.set("state", i.state);
  u.searchParams.set("code_challenge", i.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  if (i.loginHint) u.searchParams.set("login_hint", i.loginHint);
  return u.toString();
}

/**
 * The link a user's IT admin opens to approve FirstLine for their whole organisation. `/.default` grants
 * the permissions configured on the app registration (the same five). "organizations" lets the admin
 * sign in to their own tenant.
 */
export function adminConsentUrl(i: { clientId: string; redirectUri: string; state: string; tenant?: string }): string {
  const u = new URL(`${MS_AUTHORITY}/${i.tenant ?? MS_TENANT}/v2.0/adminconsent`);
  u.searchParams.set("client_id", i.clientId);
  u.searchParams.set("redirect_uri", i.redirectUri);
  u.searchParams.set("state", i.state);
  u.searchParams.set("scope", "https://graph.microsoft.com/.default");
  return u.toString();
}

/** Did Microsoft send the user back because consent is missing (needs an admin, or they said no)? */
export function isConsentError(error: string | null, description: string | null): boolean {
  if (!error) return false;
  if (["consent_required", "access_denied", "interaction_required"].includes(error)) return true;
  return /AADSTS(65001|65004|90094|90095)/.test(description ?? "");
}

// ---- Tokens --------------------------------------------------------------------------------------

export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string; tenantId: string | null; accountId: string | null; username: string | null };

/**
 * A token request failed. `disconnected`: the user or an admin revoked access, an admin reset the
 * password, the token ran out (90 days unused), or consent is missing: the inbox needs connecting
 * again. `temporary`: try later (network, Microsoft outage, throttling).
 */
export class MicrosoftAuthError extends Error {
  constructor(
    message: string,
    readonly kind: "disconnected" | "temporary",
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "MicrosoftAuthError";
  }
}

export interface MicrosoftAuth {
  exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenSet>;
  /** Refresh tokens rotate: always store the new one. */
  refresh(refreshToken: string): Promise<TokenSet>;
}

const DISCONNECT_ERRORS = new Set(["invalid_grant", "interaction_required", "consent_required", "unauthorized_client", "invalid_client"]);

function idClaims(idToken: unknown): { tid: string | null; oid: string | null; username: string | null } {
  if (typeof idToken !== "string") return { tid: null, oid: null, username: null };
  try {
    // Straight from Microsoft's token endpoint over TLS (code flow), so the payload is read, not re-verified.
    const p = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return { tid: p.tid ?? null, oid: p.oid ?? null, username: p.preferred_username ?? p.email ?? null };
  } catch {
    return { tid: null, oid: null, username: null };
  }
}

export function realMicrosoftAuth(clientId: string, clientSecret: string, fetchImpl: typeof fetch = fetch): MicrosoftAuth {
  async function token(params: Record<string, string>): Promise<TokenSet> {
    let res: Response;
    try {
      res = await fetchImpl(`${MS_AUTHORITY}/${MS_TENANT}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: MS_SCOPES.join(" "), ...params }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new MicrosoftAuthError(`Microsoft sign-in unreachable: ${(e as Error).message}`, "temporary");
    }
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = typeof j.error === "string" ? j.error : null;
      const aadsts = typeof j.error_description === "string" ? (j.error_description.match(/AADSTS\d+/)?.[0] ?? null) : null;
      const kind = code && DISCONNECT_ERRORS.has(code) ? "disconnected" : "temporary";
      throw new MicrosoftAuthError(`Microsoft token request failed: ${code ?? res.status}${aadsts ? ` (${aadsts})` : ""}`, kind, aadsts ?? code);
    }
    const claims = idClaims(j.id_token);
    return {
      accessToken: String(j.access_token ?? ""),
      refreshToken: String(j.refresh_token ?? params.refresh_token ?? ""),
      expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000),
      scope: String(j.scope ?? ""),
      tenantId: claims.tid,
      accountId: claims.oid,
      username: claims.username,
    };
  }
  return {
    exchangeCode: (code, verifier, redirectUri) => token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }),
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
  };
}

/** Which required scopes the token doesn't carry ("https://graph.microsoft.com/Mail.Send" counts as Mail.Send). */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(/\s+/).map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()));
  return MS_REQUIRED.filter((s) => !have.has(s.toLowerCase()));
}

// ---- Graph mail ----------------------------------------------------------------------------------

export type Address = { address: string; name?: string | null };
export type SentItem = { id: string; conversationId: string; subject: string; to: string[]; sentAt: Date; sendId: string | null };
export type InboxItem = { id: string; conversationId: string; subject: string; from: Address | null; receivedAt: Date };

export interface GraphMail {
  me(): Promise<{ email: string; id: string }>;
  /** Step 1. Graph answers 202 without the message id; find it afterwards with recentSent. */
  sendMail(i: { to: string; subject: string; text: string; sendId: string }): Promise<void>;
  /** A follow-up as a reply in the same conversation, to the lead (not to ourselves). */
  reply(messageId: string, i: { to: string; text: string; sendId: string }): Promise<void>;
  recentSent(top: number): Promise<SentItem[]>;
  /** New Inbox messages since the last call (delta query), properties only. */
  inboxDelta(deltaLink: string | null, since: Date): Promise<{ messages: InboxItem[]; deltaLink: string }>;
}

async function graphError(res: Response, what: string): Promise<HttpError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return new HttpError(`Graph ${what}: ${res.status}${body.error?.code ? ` ${body.error.code}` : ""}`, res.status, parseRetryAfter(res.headers.get("retry-after")));
}

const addr = (a: unknown): Address | null => {
  const e = (a as { emailAddress?: { address?: string; name?: string } } | null)?.emailAddress;
  return e?.address ? { address: e.address, name: e.name ?? null } : null;
};

export function realGraphMail(accessToken: string, fetchImpl: typeof fetch = fetch): GraphMail {
  const call = async (method: string, url: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await fetchImpl(url.startsWith("http") ? url : `${GRAPH}${url}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await graphError(res, `${method} ${url.replace(/\?.*$/, "").replace(GRAPH, "")}`);
    return res.status === 202 || res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  };
  const header = (sendId: string) => [{ name: SEND_ID_HEADER, value: sendId }];
  return {
    async me() {
      const j = (await call("GET", "/me?$select=id,mail,userPrincipalName"))!;
      return { id: String(j.id), email: String(j.mail ?? j.userPrincipalName ?? "").toLowerCase() };
    },
    async sendMail(i) {
      await call("POST", "/me/sendMail", {
        message: {
          subject: i.subject,
          body: { contentType: "Text", content: i.text },
          toRecipients: [{ emailAddress: { address: i.to } }],
          internetMessageHeaders: header(i.sendId),
        },
        saveToSentItems: true,
      });
    },
    async reply(messageId, i) {
      const base = { comment: i.text };
      const message = { toRecipients: [{ emailAddress: { address: i.to } }] };
      try {
        await call("POST", `/me/messages/${encodeURIComponent(messageId)}/reply`, { ...base, message: { ...message, internetMessageHeaders: header(i.sendId) } });
      } catch (e) {
        // If Graph refuses our header on a reply, send it without (we then match by recipient and time).
        if (!(e instanceof HttpError) || e.status !== 400) throw e;
        await call("POST", `/me/messages/${encodeURIComponent(messageId)}/reply`, { ...base, message });
      }
    },
    async recentSent(top) {
      const q = `$top=${top}&$orderby=sentDateTime desc&$select=id,conversationId,subject,toRecipients,sentDateTime`;
      let j: Record<string, unknown> | null;
      try {
        j = await call("GET", `/me/mailFolders/sentitems/messages?${q},internetMessageHeaders`);
      } catch (e) {
        if (!(e instanceof HttpError) || (e.status !== 400 && e.status !== 403)) throw e;
        j = await call("GET", `/me/mailFolders/sentitems/messages?${q}`);
      }
      return ((j?.value as Record<string, unknown>[]) ?? []).map((m) => ({
        id: String(m.id),
        conversationId: String(m.conversationId ?? ""),
        subject: String(m.subject ?? ""),
        to: ((m.toRecipients as unknown[]) ?? []).map(addr).filter((a): a is Address => !!a).map((a) => a.address.toLowerCase()),
        sentAt: new Date(String(m.sentDateTime)),
        sendId: ((m.internetMessageHeaders as { name: string; value: string }[] | undefined) ?? []).find((h) => h.name.toLowerCase() === SEND_ID_HEADER)?.value ?? null,
      }));
    },
    async inboxDelta(deltaLink, since) {
      let url =
        deltaLink ??
        `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=id,conversationId,subject,from,receivedDateTime&$filter=receivedDateTime ge ${since.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
      const messages: InboxItem[] = [];
      for (let page = 0; page < 20; page++) {
        const j = (await call("GET", url, undefined, { prefer: "odata.maxpagesize=50" }))!;
        for (const m of (j.value as Record<string, unknown>[]) ?? []) {
          if (m["@removed"]) continue;
          messages.push({ id: String(m.id), conversationId: String(m.conversationId ?? ""), subject: String(m.subject ?? ""), from: addr(m.from), receivedAt: new Date(String(m.receivedDateTime)) });
        }
        if (typeof j["@odata.deltaLink"] === "string") return { messages, deltaLink: j["@odata.deltaLink"] };
        if (typeof j["@odata.nextLink"] !== "string") break;
        url = j["@odata.nextLink"];
      }
      // Very busy inbox: continue from where we stopped next time.
      return { messages, deltaLink: url };
    },
  };
}

// ---- Matching (pure) -----------------------------------------------------------------------------

/** Our email in Sent Items: by our header when Graph returns it, else the one unique recipient + subject match after `after`. */
export function findSent(items: SentItem[], want: { sendId: string; to: string; subject: string; after: Date }): SentItem | null {
  const byHeader = items.find((i) => i.sendId === want.sendId);
  if (byHeader) return byHeader;
  const to = want.to.toLowerCase();
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const hits = items.filter((i) => i.to.includes(to) && norm(i.subject) === norm(want.subject) && i.sentAt.getTime() >= want.after.getTime() - 120_000);
  return hits.length === 1 ? hits[0] : null;
}

const NDR_FROM = /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]{32})@/i;
const NDR_SUBJECT = /^\s*(undeliverable|onbestelbaar|niet bezorgd|unzustellbar|nicht zustellbar|non remis|non distribuable|delivery status notification \(failure\)|mail delivery failed|returned mail)\s*:?\s*/i;
const AUTO_REPLY = /^\s*(automatic reply|automatisch antwoord|automatische antwort|réponse automatique|out of office|afwezig|abwesend)\b/i;

export type Tracked = { sendId: string; conversationId: string; subject: string };
export type InboxEvent = { send_id: string; type: "replied" | "bounced" };

/**
 * What a new Inbox message means for our sends, from properties only (no body):
 * - from our own address, or an out-of-office auto-reply: nothing;
 * - a non-delivery report (postmaster / Microsoft Exchange, "Undeliverable: …"): bounced, matched by
 *   conversation, else by the original subject when exactly one tracked email has it;
 * - anything else in a tracked conversation: replied.
 */
export function classifyInboxMessage(m: InboxItem, ctx: { inboxEmail: string; tracked: Tracked[] }): InboxEvent | null {
  const from = m.from?.address.toLowerCase() ?? "";
  if (from === ctx.inboxEmail.toLowerCase()) return null;
  const inConversation = ctx.tracked.filter((t) => t.conversationId && t.conversationId === m.conversationId);
  if (NDR_FROM.test(from) && NDR_SUBJECT.test(m.subject)) {
    if (inConversation.length) return { send_id: inConversation[inConversation.length - 1].sendId, type: "bounced" };
    const original = m.subject.replace(NDR_SUBJECT, "").trim().toLowerCase();
    const bySubject = ctx.tracked.filter((t) => t.subject.trim().toLowerCase() === original || `re: ${t.subject.trim().toLowerCase()}` === original);
    const leads = new Set(bySubject.map((t) => t.conversationId));
    return leads.size === 1 ? { send_id: bySubject[bySubject.length - 1].sendId, type: "bounced" } : null;
  }
  if (AUTO_REPLY.test(m.subject)) return null;
  return inConversation.length ? { send_id: inConversation[inConversation.length - 1].sendId, type: "replied" } : null;
}
