// A fake Microsoft 365 for tests and local development (MICROSOFT_CLIENT_ID=fake-microsoft, or no client
// id outside production): consent, tokens, sending, threaded replies, an Inbox with replies and bounces,
// revoked access and throttling. Same interfaces as the real client (microsoft.ts). No network.
import { HttpError } from "@/engine/retry";
import { MicrosoftAuthError, MS_SCOPES, type GraphMail, type InboxItem, type MicrosoftAuth, type SentItem, type TokenSet } from "./microsoft";

type Mailbox = { email: string; id: string; tenant: string; sent: (SentItem & { text: string })[]; inbox: InboxItem[]; revoked: boolean; scopes: string };

export class FakeMicrosoft {
  readonly boxes = new Map<string, Mailbox>();
  /** Graph calls that fail with 429 next (Retry-After in ms). */
  throttle: { remaining: number; retryAfterMs: number } = { remaining: 0, retryAfterMs: 1000 };
  /** Simulate Mail.ReadBasic not returning our header: Sent Items then match by recipient + subject. */
  hideHeaders = false;
  calls: string[] = [];
  private seq = 0;
  private now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  /** The codes the fake consent page hands back: "fake-ok:<email>" grants everything; "fake-noscope:<email>" leaves out Mail.Send. */
  static code(email: string, ok = true) {
    return `${ok ? "fake-ok" : "fake-noscope"}:${email.toLowerCase()}`;
  }

  private box(email: string): Mailbox {
    let b = this.boxes.get(email);
    if (!b) {
      b = { email, id: `oid-${email}`, tenant: `tid-${email.split("@")[1]}`, sent: [], inbox: [], revoked: false, scopes: MS_SCOPES.join(" ") };
      this.boxes.set(email, b);
    }
    return b;
  }

  private tokens(b: Mailbox): TokenSet {
    return {
      accessToken: `fake-at:${b.email}`,
      refreshToken: `fake-rt:${b.email}:${++this.seq}`,
      expiresAt: new Date(this.now().getTime() + 3600_000),
      scope: b.scopes,
      tenantId: b.tenant,
      accountId: b.id,
      username: b.email,
    };
  }

  auth(): MicrosoftAuth {
    return {
      exchangeCode: async (code) => {
        const m = code.match(/^fake-(ok|noscope):(.+)$/);
        if (!m) throw new MicrosoftAuthError("Microsoft token request failed: invalid_grant", "disconnected", "invalid_grant");
        const b = this.box(m[2]);
        b.revoked = false;
        b.scopes = m[1] === "ok" ? MS_SCOPES.join(" ") : "openid offline_access User.Read Mail.ReadBasic";
        return this.tokens(b);
      },
      refresh: async (rt) => {
        const email = rt.match(/^fake-rt:(.+):\d+$/)?.[1];
        // Another process (the worker) may not have seen this mailbox yet: it exists unless revoked.
        const b = email ? this.box(email) : undefined;
        if (!b || b.revoked) throw new MicrosoftAuthError("Microsoft token request failed: invalid_grant (AADSTS50173)", "disconnected", "AADSTS50173");
        return this.tokens(b);
      },
    };
  }

  /** Access revoked (admin reset the password, consent withdrawn, 90 days unused). */
  revoke(email: string) {
    this.box(email).revoked = true;
  }

  /** Someone else writes into this mailbox's Inbox. */
  receive(email: string, m: { from: string; subject: string; conversationId: string; fromName?: string }) {
    this.box(email).inbox.push({ id: `in-${++this.seq}`, conversationId: m.conversationId, subject: m.subject, from: { address: m.from, name: m.fromName ?? null }, receivedAt: this.now() });
  }

  private gate(what: string) {
    this.calls.push(what);
    if (this.throttle.remaining > 0) {
      this.throttle.remaining--;
      throw new HttpError(`Graph ${what}: 429 TooManyRequests`, 429, this.throttle.retryAfterMs);
    }
  }

  graph(accessToken: string): GraphMail {
    const email = accessToken.replace(/^fake-at:/, "");
    const b = () => {
      const x = this.boxes.get(email);
      if (!x || x.revoked) throw new HttpError("Graph: 401 InvalidAuthenticationToken", 401);
      return x;
    };
    return {
      me: async () => {
        this.gate("me");
        return { email: b().email, id: b().id };
      },
      sendMail: async (i) => {
        this.gate("sendMail");
        b().sent.push({ id: `msg-${++this.seq}`, conversationId: `conv-${this.seq}`, subject: i.subject, to: [i.to.toLowerCase()], sentAt: this.now(), sendId: i.sendId, text: i.text });
      },
      reply: async (messageId, i) => {
        this.gate("reply");
        const original = b().sent.find((s) => s.id === messageId);
        if (!original) throw new HttpError("Graph reply: 404 ErrorItemNotFound", 404);
        const subject = /^re:/i.test(original.subject) ? original.subject : `RE: ${original.subject}`;
        b().sent.push({ id: `msg-${++this.seq}`, conversationId: original.conversationId, subject, to: [i.to.toLowerCase()], sentAt: this.now(), sendId: i.sendId, text: i.text });
      },
      recentSent: async (top) => {
        this.gate("recentSent");
        return [...b().sent]
          .reverse()
          .slice(0, top)
          .map((s) => ({ id: s.id, conversationId: s.conversationId, subject: s.subject, to: s.to, sentAt: s.sentAt, sendId: this.hideHeaders ? null : s.sendId }));
      },
      inboxDelta: async (deltaLink, since) => {
        this.gate("inboxDelta");
        const from = deltaLink ? Number(deltaLink.replace("fake-delta:", "")) : 0;
        const all = b().inbox;
        return { messages: all.slice(from).filter((m) => m.receivedAt >= since || deltaLink), deltaLink: `fake-delta:${all.length}` };
      },
    };
  }
}
