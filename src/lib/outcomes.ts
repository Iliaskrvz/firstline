// Reply rate per skill version and channel, from outcome rows (no personal data). Pure.

/** Below this many sent emails a reply rate is shown, but marked as too early to compare. */
export const MIN_SENT_FOR_RATE = 100;

export type OutcomeCount = { skill_version: string | null; channel: string; personalised: boolean; status: string; n: number };
export type ReplyRateRow = {
  skillVersion: string;
  channel: string;
  handedOver: number; // exported or pushed, not (yet) known as sent
  sent: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  replyRate: number | null;
  enough: boolean;
};

export function replyRates(counts: OutcomeCount[]): ReplyRateRow[] {
  const rows = new Map<string, ReplyRateRow>();
  for (const c of counts) {
    const key = `${c.skill_version ?? "?"}|${c.channel}`;
    const r = rows.get(key) ?? { skillVersion: c.skill_version ?? "unknown", channel: c.channel, handedOver: 0, sent: 0, replied: 0, bounced: 0, unsubscribed: 0, replyRate: null, enough: false };
    if (c.status === "exported" || c.status === "pushed") r.handedOver += c.n;
    else {
      r.sent += c.n; // replied, bounced and unsubscribed emails were sent too
      if (c.status === "replied") r.replied += c.n;
      if (c.status === "bounced") r.bounced += c.n;
      if (c.status === "unsubscribed") r.unsubscribed += c.n;
    }
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, replyRate: r.sent ? Math.round((r.replied / r.sent) * 1000) / 10 : null, enough: r.sent >= MIN_SENT_FOR_RATE }))
    .sort((a, b) => b.skillVersion.localeCompare(a.skillVersion) || a.channel.localeCompare(b.channel));
}
