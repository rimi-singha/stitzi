import { describe, expect, it } from "vitest";
import { WebPlatformAdapter } from "./webPlatform";

describe("WebPlatformAdapter", () => {
  it("autosaves, reads back, and clears payloads", async () => {
    const adapter = new WebPlatformAdapter();
    await adapter.autosaveWrite("doc-test", '{"hello":"world"}');
    expect(await adapter.autosaveRead("doc-test")).toBe('{"hello":"world"}');
    await adapter.autosaveClear("doc-test");
    expect(await adapter.autosaveRead("doc-test")).toBeNull();
  });
});
