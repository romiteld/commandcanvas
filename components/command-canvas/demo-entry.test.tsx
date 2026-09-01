import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoEntry } from "@/components/command-canvas/demo-entry";

describe("DemoEntry", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => {
    delete (document as unknown as { modelContext?: unknown }).modelContext;
  });

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
    expect(
      screen.getByRole("link", { name: "Use durable workspace with email OTP" }),
    ).toHaveAttribute("href", "/meet");
    expect(
      screen.getByRole("link", { name: "Use durable workspace with email OTP" }),
    ).toHaveClass("demo-entry-secondary");
    expect(
      screen.getByRole("button", { name: "Enter no-signup preview" }),
    ).toHaveClass("demo-entry-primary");
    expect(
      screen.getByText(/no additional ChatGPT sign-in is required/i),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Enter no-signup preview" }),
    );

    expect(screen.getByText("Hosted preview mounted")).toBeVisible();
    expect(window.sessionStorage.getItem("commandcanvas.demo-entry.accepted.v1")).toBe(
      "accepted",
    );
  });

  it("remembers an explicit preview choice for reloads in the same browser tab", async () => {
    window.sessionStorage.setItem(
      "commandcanvas.demo-entry.accepted.v1",
      "accepted",
    );

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    await waitFor(() =>
      expect(screen.getByText("Hosted preview mounted")).toBeVisible(),
    );
    expect(
      screen.queryByRole("button", { name: "Enter no-signup preview" }),
    ).not.toBeInTheDocument();
  });

  it("reports the Site Tools surface after hydration without claiming a ChatGPT host identity", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn() },
    });

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Site Tools registration surface is available/i),
      ).toBeVisible(),
    );
    expect(screen.queryByText(/ChatGPT Site Tools can register/i)).toBeNull();
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });
});
