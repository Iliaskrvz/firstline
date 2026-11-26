import { describe, expect, it } from "vitest";
import { campaignSteps } from "./campaign-steps";

const base = {
  templateOk: false,
  previewCount: 0,
  written: 0,
  remaining: 10,
  inFlight: false,
  started: false,
};

describe("campaign page steps", () => {
  it("a new campaign starts at set up", () => {
    expect(campaignSteps(base)).toEqual({
      done: { setup: false, preview: false, run: false, send: false },
      current: "setup",
    });
  });

  it("template chosen → free preview; preview run → run", () => {
    expect(campaignSteps({ ...base, templateOk: true }).current).toBe(
      "preview",
    );
    expect(
      campaignSteps({ ...base, templateOk: true, previewCount: 5 }).current,
    ).toBe("run");
  });

  it("a run in progress keeps the run step open; when every lead is done, send is next", () => {
    expect(
      campaignSteps({
        ...base,
        templateOk: true,
        previewCount: 5,
        started: true,
        inFlight: true,
        written: 3,
        remaining: 7,
      }).current,
    ).toBe("run");
    const finished = campaignSteps({
      ...base,
      templateOk: true,
      previewCount: 5,
      started: true,
      written: 10,
      remaining: 0,
    });
    expect(finished.current).toBe("send");
    expect(finished.done).toEqual({
      setup: true,
      preview: true,
      run: true,
      send: false,
    });
  });

  it("running without a preview counts the preview step as behind you", () => {
    expect(
      campaignSteps({
        ...base,
        templateOk: true,
        started: true,
        written: 2,
        remaining: 8,
      }).done.preview,
    ).toBe(true);
  });

  it("failed leads waiting to be run again keep the run step open", () => {
    expect(
      campaignSteps({
        ...base,
        templateOk: true,
        previewCount: 5,
        started: true,
        written: 9,
        remaining: 1,
      }).current,
    ).toBe("run");
  });
});
