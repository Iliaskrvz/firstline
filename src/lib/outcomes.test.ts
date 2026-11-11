import { describe, expect, it } from "vitest";
import { MIN_SENT_FOR_RATE, replyRates } from "./outcomes";

describe("reply rates", () => {
  it("counts sent, replies, bounces per version and channel", () => {
    const r = replyRates([
      { skill_version: "1.0", channel: "gmail", personalised: true, status: "sent", n: 90 },
      { skill_version: "1.0", channel: "gmail", personalised: true, status: "replied", n: 8 },
      { skill_version: "1.0", channel: "gmail", personalised: false, status: "bounced", n: 2 },
      { skill_version: "1.0", channel: "csv", personalised: true, status: "exported", n: 40 },
      { skill_version: "1.1", channel: "instantly", personalised: true, status: "pushed", n: 5 },
    ]);
    expect(r[0]).toMatchObject({ skillVersion: "1.1", channel: "instantly", handedOver: 5, sent: 0, replyRate: null });
    const gmail = r.find((x) => x.channel === "gmail")!;
    expect(gmail).toMatchObject({ sent: 100, replied: 8, bounced: 2, replyRate: 8, enough: MIN_SENT_FOR_RATE <= 100 });
    expect(r.find((x) => x.channel === "csv")).toMatchObject({ handedOver: 40, sent: 0 });
  });
});
