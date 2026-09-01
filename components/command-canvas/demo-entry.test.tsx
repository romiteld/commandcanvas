import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoEntry } from "@/components/command-canvas/demo-entry";
import * as browserClientModule from "@/lib/supabase/browser-client";

describe("DemoEntry", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/demo");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (document as unknown as { modelContext?: unknown }).modelContext;
  });

  it("keeps normal /demo no-signup-first without mounting a room before its one click", async () => {
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Enter no-signup preview" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "Account sign-in" })).toBeVisible();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("Hosted preview mounted")).not.toBeInTheDocument();
  });

  it("recognizes an existing permanent session without presenting a second sign-in gate", async () => {
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "11111111-1111-4111-8111-111111111111",
                  email: "Danny@Example.com",
                  is_anonymous: false,
                },
              },
            },
            error: null,
          })),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    expect(await screen.findByText("Hosted preview mounted")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign in with email code" })).not.toBeInTheDocument();
  });

  it("keeps the OTP gate open when verification resolves after unmount", async () => {
    const user = userEvent.setup();
    let resolveVerification!: (value: {
      data: {
        session: { access_token: string } | null;
        user: {
          id: string;
          email: string;
          is_anonymous: boolean;
        } | null;
      };
      error: null;
    }) => void;
    const verifyOtp = vi.fn(
      () =>
        new Promise<Parameters<typeof resolveVerification>[0]>((resolve) => {
          resolveVerification = resolve;
        }),
    );
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
          verifyOtp,
        },
      },
    } as never);

    const view = render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );
    await user.click(await screen.findByRole("button", { name: "Account sign-in" }));
    await user.type(screen.getByLabelText("Email"), "danny@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(verifyOtp).toHaveBeenCalledOnce();

    view.unmount();
    resolveVerification({
      data: {
        session: { access_token: "header.payload.signature" },
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "danny@example.com",
          is_anonymous: false,
        },
      },
      error: null,
    });
    await Promise.resolve();

    expect(window.sessionStorage.getItem("commandcanvas.demo-entry.accepted.v1")).toBeNull();
  });

  it("verifies on /demo, clears anonymous room recovery, and re-enters as the permanent actor", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/demo?signin=1");
    window.sessionStorage.setItem("commandcanvas.demo.room.v1", "anonymous-room-recovery");
    const verifyOtp = vi.fn(async () => ({
      data: {
        session: { access_token: "header.payload.signature" },
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "danny@example.com",
          is_anonymous: false,
        },
      },
      error: null,
    }));
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
          verifyOtp,
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Sign in with email code" }),
    );
    await user.type(screen.getByLabelText("Email"), "danny@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByText("Hosted preview mounted")).toBeVisible();
    expect(verifyOtp).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/demo");
    expect(window.location.search).toBe("");
    expect(window.sessionStorage.getItem("commandcanvas.demo.room.v1")).toBeNull();
  });

  it("preserves the email after a thrown OTP request", async () => {
    const user = userEvent.setup();
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          signInWithOtp: vi.fn(async () => {
            throw new Error("mail provider unavailable");
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );
    await user.click(await screen.findByRole("button", { name: "Account sign-in" }));
    const email = screen.getByLabelText("Email");
    await user.type(email, "danny@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sign-in code could not be sent.",
    );
    expect(email).toHaveValue("danny@example.com");
  });

  it("returns an actionable error when OTP verification throws", async () => {
    const user = userEvent.setup();
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
          verifyOtp: vi.fn(async () => {
            throw new Error("auth provider unavailable");
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );
    await user.click(await screen.findByRole("button", { name: "Account sign-in" }));
    await user.type(screen.getByLabelText("Email"), "danny@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The code is invalid or expired.",
    );
    expect(screen.getByLabelText("Six-digit code")).toBeVisible();
  });

  it("makes ?signin=1 override a prior preview acceptance", async () => {
    window.sessionStorage.setItem(
      "commandcanvas.demo-entry.accepted.v1",
      "accepted",
    );
    window.history.replaceState(null, "", "/demo?signin=1");
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "anonymous-user",
                  is_anonymous: true,
                },
              },
            },
            error: null,
          })),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    expect(await screen.findByRole("button", { name: "Sign in with email code" })).toBeVisible();
    expect(screen.queryByText("Hosted preview mounted")).not.toBeInTheDocument();
  });

  it("keeps the server-rendered entry control inert until hydration", async () => {
    const user = userEvent.setup();
    const container = document.createElement("div");
    const entry = (
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>
    );
    container.innerHTML = renderToString(entry);
    document.body.append(container);

    const button = within(container).getByRole("button", {
      name: "Enter no-signup preview",
    });
    expect(button).toBeDisabled();

    const recoverableErrors: unknown[] = [];
    const root = hydrateRoot(container, entry, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    try {
      await waitFor(() =>
        expect(
          within(container).getByRole("button", {
            name: "Enter no-signup preview",
          }),
        ).toBeEnabled(),
      );
      expect(recoverableErrors).toEqual([]);

      await user.click(
        within(container).getByRole("button", {
          name: "Enter no-signup preview",
        }),
      );
      expect(within(container).getByText("Hosted preview mounted")).toBeVisible();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("does not allocate the limited Supabase preview until the visitor explicitly continues", async () => {
    const user = userEvent.setup();
    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Enter no-signup preview" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("heading", { name: "Choose how to enter CommandCanvas" }),
    ).toBeVisible();
    expect(screen.getByText(/anonymous Supabase identity/i)).toBeVisible();
    expect(screen.getByText(/capped demo room/i)).toBeVisible();
    expect(screen.queryByText("Hosted preview mounted")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enter no-signup preview" }),
    ).toHaveClass("demo-entry-primary");
    expect(
      screen.getByRole("button", { name: "Account sign-in" }),
    ).toHaveClass("demo-entry-secondary");
    expect(
      screen.getByText(/no additional ChatGPT sign-in is required/i),
    ).toBeVisible();
    expect(
      screen.getByText(
        /no-signup visitors receive an anonymous Supabase identity/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /permanent email-authenticated CommandCanvas identity can automatically use only its own encrypted credential through server-side Supabase Vault/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/never receive an owner key/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/It does not save an OpenAI key/i),
    ).not.toBeInTheDocument();

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
