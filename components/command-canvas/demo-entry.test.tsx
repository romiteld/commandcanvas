import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DemoEntry } from "@/components/command-canvas/demo-entry";

describe("DemoEntry", () => {
  it("does not allocate the limited Supabase preview until the visitor explicitly continues", async () => {
    const user = userEvent.setup();
    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    expect(
      screen.getByRole("heading", { name: "Choose how to enter CommandCanvas" }),
    ).toBeVisible();
    expect(screen.getByText(/temporary Supabase identity/i)).toBeVisible();
    expect(screen.getByText(/capped room/i)).toBeVisible();
    expect(screen.queryByText("Hosted preview mounted")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to CommandCanvas" })).toHaveAttribute(
      "href",
      "/meet",
    );

    await user.click(
      screen.getByRole("button", { name: "Continue limited judge preview" }),
    );

    expect(screen.getByText("Hosted preview mounted")).toBeVisible();
  });
});
