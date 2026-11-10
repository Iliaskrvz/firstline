import { describe, expect, it } from "vitest";
import { offlineEmail, resendMailer } from "./alerts";

describe("resendMailer", () => {
  it("posts to Resend with the key and the message", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"id":"x"}', { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer("re_test", "FirstLine <alerts@x.nl>", fake).send({ to: "me@x.nl", subject: "S", text: "T" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ from: "FirstLine <alerts@x.nl>", to: ["me@x.nl"], subject: "S", text: "T" });
  });

  it("throws on an error answer so the alert is retried next round", async () => {
    const fake = (async () => new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
    await expect(resendMailer("re_test", "x@y.nl", fake).send({ to: "a@b.nl", subject: "S", text: "T" })).rejects.toThrow(/403/);
  });

  it("the email says what to check", () => {
    const m = offlineEmail("me@gmail.com", new Date("2026-11-10T09:00:00Z"), "https://app.firstline.test");
    expect(m.subject).toBe("FirstLine: me@gmail.com is offline");
    expect(m.text).toContain("FirstLine → Connect…");
    expect(m.text).toContain("https://app.firstline.test/inboxes");
  });
});
