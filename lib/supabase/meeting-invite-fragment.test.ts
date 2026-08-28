import { describe, expect, it, vi } from "vitest";

import { readAndScrubMeetingInvite } from "@/lib/supabase/meeting-invite-fragment";

const TOKEN = "a".repeat(43);

describe("meeting invitation fragment transport", () => {
  it("reads the opaque token once and scrubs it before subsequent work", () => {
    const order: string[] = [];
    const replaceState = vi.fn(() => order.push("scrub"));
    const token = readAndScrubMeetingInvite({
      href: `https://commandcanvas.example/meet#invite=${TOKEN}`,
      replaceState,
    });
    order.push("fetch");

    expect(token).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/meet");
    expect(order).toEqual(["scrub", "fetch"]);
  });

  it("scrubs but refuses a query-string token and malformed fragments", () => {
    const replaceQuery = vi.fn();
    expect(
      readAndScrubMeetingInvite({
        href: `https://commandcanvas.example/meet?invite=${TOKEN}`,
        replaceState: replaceQuery,
      }),
    ).toBeNull();
    expect(replaceQuery).toHaveBeenCalledWith(null, "", "/meet");

    const replaceMalformed = vi.fn();
    expect(
      readAndScrubMeetingInvite({
        href: "https://commandcanvas.example/meet#invite=short",
        replaceState: replaceMalformed,
      }),
    ).toBeNull();
    expect(replaceMalformed).toHaveBeenCalledWith(null, "", "/meet");
  });
});
