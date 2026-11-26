// Microsoft 365 without an account: sign-in URLs, token responses and Graph calls replayed from recorded
// response shapes (learn.microsoft.com examples), and the reply/bounce rules on message properties only.
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/engine/retry";
import {
  adminConsentUrl,
  authorizeUrl,
  classifyInboxMessage,
  findSent,
  isConsentError,
  MicrosoftAuthError,
  missingScopes,
  pkcePair,
  realGraphMail,
  realMicrosoftAuth,
  type InboxItem,
} from "./microsoft";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 202 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const idToken = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

describe("sign-in", () => {
  it("work and school accounts only, least-privilege scopes, PKCE", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const u = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://app.test/connect/outlook/callback", state: "s1", codeChallenge: challenge }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("openid offline_access User.Read Mail.Send Mail.ReadBasic");
    expect(u.searchParams.get("scope")).not.toMatch(/Mail\.Read(?!Basic)|ReadWrite/);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("response_type")).toBe("code");
  });

  it("the admin consent link for the IT person", () => {
    const u = new URL(adminConsentUrl({ clientId: "cid", redirectUri: "https://app.test/connect/outlook/admin-done", state: "s2" }));
    expect(u.pathname).toBe("/organizations/v2.0/adminconsent");
    expect(u.searchParams.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  it("recognises 'needs admin approval' and 'declined' on the way back", () => {
    expect(isConsentError("access_denied", "AADSTS65004: User declined to consent")).toBe(true);
    expect(isConsentError("invalid_request", "AADSTS90094: The grant requires admin permission.")).toBe(true);
    expect(isConsentError("consent_required", null)).toBe(true);
    expect(isConsentError("server_error", "AADSTS50000")).toBe(false);
    expect(isConsentError(null, null)).toBe(false);
  });

  it("checks what was really granted", () => {
    expect(missingScopes("openid profile offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadBasic https://graph.microsoft.com/User.Read")).toEqual([]);
    expect(missingScopes("openid User.Read Mail.ReadBasic")).toEqual(["Mail.Send"]);
  });
});

describe("tokens (recorded token-endpoint responses)", () => {
  it("exchanges the code (with the PKCE verifier) and reads tenant and account from the id token", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { token_type: "Bearer", scope: "Mail.Send Mail.ReadBasic User.Read openid", expires_in: 3599, access_token: "at1", refresh_token: "rt1", id_token: idToken({ tid: "tid1", oid: "oid1", preferred_username: "anna@contoso.com" }) }),
    );
    const t = await realMicrosoftAuth("cid", "secret", fetchImpl as unknown as typeof fetch).exchangeCode("code1", "ver1", "https://app.test/cb");
    expect(t).toMatchObject({ accessToken: "at1", refreshToken: "rt1", tenantId: "tid1", accountId: "oid1", username: "anna@contoso.com" });
    const body = new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("ver1");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
  });

  it("revoked or expired access means disconnected; an outage means try later", async () => {
    const revoked = realMicrosoftAuth("cid", "s", (async () => json(400, { error: "invalid_grant", error_description: "AADSTS50173: The provided grant has expired due to it being revoked." })) as unknown as typeof fetch);
    await expect(revoked.refresh("rt")).rejects.toMatchObject({ kind: "disconnected", code: "AADSTS50173" });
    const down = realMicrosoftAuth("cid", "s", (async () => json(503, { error: "temporarily_unavailable" })) as unknown as typeof fetch);
    await expect(down.refresh("rt")).rejects.toMatchObject({ kind: "temporary" });
    const offline = realMicrosoftAuth("cid", "s", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(offline.refresh("rt")).rejects.toBeInstanceOf(MicrosoftAuthError);
  });
});

describe("Graph mail (recorded responses)", () => {
  it("sendMail: plain text to the lead, our header, saved to Sent Items", async () => {
    const fetchImpl = vi.fn(async () => json(202, null));
    await realGraphMail("at", fetchImpl as unknown as typeof fetch).sendMail({ to: "lead@x.com", subject: "Hi", text: "Body", sendId: "send-1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(JSON.parse(String(init.body))).toEqual({
      message: { subject: "Hi", body: { contentType: "Text", content: "Body" }, toRecipients: [{ emailAddress: { address: "lead@x.com" } }], internetMessageHeaders: [{ name: "x-firstline-send-id", value: "send-1" }] },
      saveToSentItems: true,
    });
  });

  it("reply: to the lead in the same conversation; without our header if Graph refuses it", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(400, { error: { code: "ErrorInvalidProperty" } })).mockResolvedValueOnce(json(202, null));
    await realGraphMail("at", fetchImpl as unknown as typeof fetch).reply("AAMk=", { to: "lead@x.com", text: "Bump", sendId: "send-2" });
    const second = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe("https://graph.microsoft.com/v1.0/me/messages/AAMk%3D/reply");
    expect(second).toEqual({ comment: "Bump", message: { toRecipients: [{ emailAddress: { address: "lead@x.com" } }] } });
  });

  it("Sent Items: reads our header when allowed, falls back when not", async () => {
    const item = { id: "m1", conversationId: "c1", subject: "Hi", sentDateTime: "2026-11-25T09:00:00Z", toRecipients: [{ emailAddress: { address: "Lead@X.com", name: "Lead" } }] };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(403, { error: { code: "ErrorAccessDenied" } })).mockResolvedValueOnce(json(200, { value: [item] }));
    const items = await realGraphMail("at", fetchImpl as unknown as typeof fetch).recentSent(20);
    expect(items).toEqual([{ id: "m1", conversationId: "c1", subject: "Hi", to: ["lead@x.com"], sentAt: new Date("2026-11-25T09:00:00Z"), sendId: null }]);
  });

  it("Inbox delta: follows pages to the delta link, skips removed items", async () => {
    const msg = (id: string) => ({ id, conversationId: "c1", subject: "Re: Hi", receivedDateTime: "2026-11-25T10:00:00Z", from: { emailAddress: { address: "lead@x.com", name: "Lead" } } });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { value: [msg("a")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }))
      .mockResolvedValueOnce(json(200, { value: [msg("b"), { id: "gone", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta2" }));
    const r = await realGraphMail("at", fetchImpl as unknown as typeof fetch).inboxDelta(null, new Date("2026-11-20T00:00:00Z"));
    expect(r.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(r.deltaLink).toBe("https://graph.microsoft.com/v1.0/delta2");
    expect(decodeURIComponent((fetchImpl.mock.calls[0] as unknown as [string])[0])).toContain("$filter=receivedDateTime ge 2026-11-20T00:00:00Z");
  });

  it("throttling surfaces as a retryable 429 with Microsoft's Retry-After", async () => {
    const g = realGraphMail("at", (async () => json(429, { error: { code: "ApplicationThrottled" } }, { "retry-after": "17" })) as unknown as typeof fetch);
    const e = await g.sendMail({ to: "a@b.c", subject: "s", text: "t", sendId: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status: 429, retryAfterMs: 17_000 });
  });
});

describe("finding our email and reading the Inbox (properties only)", () => {
  const t0 = new Date("2026-11-25T09:00:00Z");

  it("finds the sent email by header, else by one unique recipient + subject match", () => {
    const a = { id: "1", conversationId: "c1", subject: "Hi", to: ["lead@x.com"], sentAt: t0, sendId: null };
    expect(findSent([a], { sendId: "s", to: "LEAD@x.com", subject: "hi ", after: t0 })).toBe(a);
    expect(findSent([a, { ...a, id: "2" }], { sendId: "s", to: "lead@x.com", subject: "Hi", after: t0 })).toBeNull(); // ambiguous
    expect(findSent([{ ...a, sendId: "s" }, { ...a, id: "2" }], { sendId: "s", to: "lead@x.com", subject: "Hi", after: t0 })?.id).toBe("1");
  });

  const tracked = [
    { sendId: "s1", conversationId: "c1", subject: "Idea for Acme" },
    { sendId: "s2", conversationId: "c2", subject: "Idea for Beta" },
  ];
  const m = (over: Partial<InboxItem>): InboxItem => ({ id: "i", conversationId: "c1", subject: "RE: Idea for Acme", from: { address: "lead@acme.com" }, receivedAt: t0, ...over });
  const ctx = { inboxEmail: "me@us.com", tracked };

  it("a reply in a tracked conversation; never our own mail or out-of-office", () => {
    expect(classifyInboxMessage(m({}), ctx)).toEqual({ send_id: "s1", type: "replied" });
    expect(classifyInboxMessage(m({ from: { address: "ME@us.com" } }), ctx)).toBeNull();
    expect(classifyInboxMessage(m({ subject: "Automatic reply: Idea for Acme" }), ctx)).toBeNull();
    expect(classifyInboxMessage(m({ subject: "Automatisch antwoord: Idea for Acme" }), ctx)).toBeNull();
    expect(classifyInboxMessage(m({ conversationId: "other" }), ctx)).toBeNull();
  });

  it("a bounce from the postmaster, by conversation or by a unique original subject", () => {
    const ndr = { from: { address: "postmaster@us.onmicrosoft.com" } };
    expect(classifyInboxMessage(m({ ...ndr, subject: "Undeliverable: Idea for Acme" }), ctx)).toEqual({ send_id: "s1", type: "bounced" });
    expect(classifyInboxMessage(m({ ...ndr, conversationId: "new", subject: "Onbestelbaar: Idea for Beta" }), ctx)).toEqual({ send_id: "s2", type: "bounced" });
    expect(
      classifyInboxMessage(m({ from: { address: "MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@us.com" }, conversationId: "new", subject: "Undeliverable: Idea for Acme" }), ctx),
    ).toEqual({ send_id: "s1", type: "bounced" });
    // Two tracked emails with the same subject: not guessed.
    expect(classifyInboxMessage(m({ ...ndr, conversationId: "new", subject: "Undeliverable: Same" }), { ...ctx, tracked: [...tracked, { sendId: "a", conversationId: "x", subject: "Same" }, { sendId: "b", conversationId: "y", subject: "Same" }] })).toBeNull();
  });
});
