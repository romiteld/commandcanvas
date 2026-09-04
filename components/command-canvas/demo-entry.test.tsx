import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoEntry } from "@/components/command-canvas/demo-entry";
import { useDemoAuthenticatedIdentity } from "@/components/command-canvas/demo-auth-context";
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

  it("keeps the no-signup action usable while session recovery never settles", async () => {
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as never);

    const user = userEvent.setup();
    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    const enter = await screen.findByRole("button", {
      name: "Enter no-signup preview",
    });
    expect(enter).toBeEnabled();
    await user.click(enter);
    expect(screen.getByText("Hosted preview mounted")).toBeVisible();
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
                  email_confirmed_at: "2026-09-01T00:00:00.000Z",
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
    const recoveredEmail = screen.getByLabelText("Email");
    expect(recoveredEmail).toHaveValue("danny@example.com");
    expect(recoveredEmail).toHaveFocus();
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
    expect(screen.getByLabelText("Six-digit code")).toHaveFocus();
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

  it("reports WebMCP registration-surface detection without treating the entry gate as a tool switch", async () => {
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
        screen.getByText(/A WebMCP registration surface was detected in this tab/i),
      ).toBeVisible(),
    );
    expect(
      screen.getByText(/automatically registers its tools when the live canvas is ready/i),
    ).toBeVisible();
    expect(
      screen.getByText(/activity drawer.*only inspects registration and activity/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/WebMCP tools are available in this tab/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it("keeps an accepted no-signup room mounted when Supabase emits its expected anonymous sign-in", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe } } };
          }),
        },
      },
    } as never);
    window.sessionStorage.setItem("commandcanvas.demo-entry.accepted.v1", "accepted");

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );
    expect(await screen.findByText("Hosted preview mounted")).toBeVisible();

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "anonymous-actor",
          is_anonymous: true,
        },
      }),
    );

    expect(screen.getByText("Hosted preview mounted")).toBeVisible();
    expect(window.sessionStorage.getItem("commandcanvas.demo-entry.accepted.v1")).toBe(
      "accepted",
    );
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("blocks an accepted preview from mounting under an unconfirmed replacement actor", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "confirmed-actor",
                  email: "danny@example.com",
                  is_anonymous: false,
                  email_confirmed_at: "2026-09-01T00:00:00.000Z",
                },
              },
            },
            error: null,
          })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );
    expect(await screen.findByText("Hosted preview mounted")).toBeVisible();

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "unconfirmed-actor",
          email: "unconfirmed@example.com",
          is_anonymous: false,
          email_confirmed_at: null,
        },
      }),
    );

    expect(screen.queryByText("Hosted preview mounted")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter no-signup preview" })).toBeVisible();
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Enter no-signup preview" }),
    );
    expect(screen.queryByText("Hosted preview mounted")).not.toBeInTheDocument();
  });

  it("tears down then recovers a replacement confirmed actor before mounting its child", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    const Child = () => {
      const identity = useDemoAuthenticatedIdentity();
      return <div>Hosted as {identity?.email ?? "anonymous"}</div>;
    };
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "first-actor",
                  email: "first@example.com",
                  is_anonymous: false,
                  email_confirmed_at: "2026-09-01T00:00:00.000Z",
                },
              },
            },
            error: null,
          })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <Child />
      </DemoEntry>,
    );
    expect(await screen.findByText("Hosted as first@example.com")).toBeVisible();

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "second-actor",
          email: "second@example.com",
          is_anonymous: false,
          email_confirmed_at: "2026-09-01T00:00:00.000Z",
        },
      }),
    );

    expect(screen.getByText("Hosted as second@example.com")).toBeVisible();
    expect(screen.queryByText("Hosted as first@example.com")).not.toBeInTheDocument();
  });

  it("adopts the verified OTP actor before its delayed sign-in event arrives", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/demo?signin=1");
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
          signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
          verifyOtp: vi.fn(async () => ({
            data: {
              session: { access_token: "header.payload.signature" },
              user: {
                id: "otp-actor",
                email: "danny@example.com",
                is_anonymous: false,
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
    await user.click(await screen.findByRole("button", { name: "Sign in with email code" }));
    await user.type(screen.getByLabelText("Email"), "danny@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText("Hosted preview mounted")).toBeVisible();

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "otp-actor",
          email: "danny@example.com",
          is_anonymous: false,
          email_confirmed_at: "2026-09-01T00:00:00.000Z",
        },
      }),
    );
    expect(screen.getByText("Hosted preview mounted")).toBeVisible();
  });

  it("keeps a newer confirmed actor authoritative when initial recovery resolves last", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    let resolveRecovery!: (value: {
      data: { session: null };
      error: null;
    }) => void;
    const Child = () => {
      const identity = useDemoAuthenticatedIdentity();
      return <div>Hosted as {identity?.email ?? "anonymous"}</div>;
    };
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(
            () =>
              new Promise<Parameters<typeof resolveRecovery>[0]>((resolve) => {
                resolveRecovery = resolve;
              }),
          ),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <Child />
      </DemoEntry>,
    );
    await waitFor(() => expect(emitAuthEvent).toBeTypeOf("function"));

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "replacement-actor",
          email: "replacement@example.com",
          is_anonymous: false,
          email_confirmed_at: "2026-09-01T00:00:00.000Z",
        },
      }),
    );
    expect(screen.getByText("Hosted as replacement@example.com")).toBeVisible();

    await act(async () => {
      resolveRecovery({ data: { session: null }, error: null });
      await Promise.resolve();
    });

    expect(screen.getByText("Hosted as replacement@example.com")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Enter no-signup preview" }),
    ).not.toBeInTheDocument();
  });

  it.each(["SIGNED_OUT", "INITIAL_SESSION"])(
    "keeps %s authoritative when stale permanent recovery resolves last",
    async (event) => {
      let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
      let resolveRecovery!: (value: {
        data: {
          session: {
            user: {
              id: string;
              email: string;
              is_anonymous: false;
              email_confirmed_at: string;
            };
          };
        };
        error: null;
      }) => void;
      vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
        ok: true,
        client: {
          auth: {
            getSession: vi.fn(
              () =>
                new Promise<Parameters<typeof resolveRecovery>[0]>((resolve) => {
                  resolveRecovery = resolve;
                }),
            ),
            onAuthStateChange: vi.fn((callback) => {
              emitAuthEvent = callback;
              return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
          },
        },
      } as never);

      render(
        <DemoEntry>
          <div>Stale permanent runtime mounted</div>
        </DemoEntry>,
      );
      await waitFor(() => expect(emitAuthEvent).toBeTypeOf("function"));

      await act(async () => emitAuthEvent?.(event, null));
      await act(async () => {
        resolveRecovery({
          data: {
            session: {
              user: {
                id: "old-actor",
                email: "old@example.com",
                is_anonymous: false,
                email_confirmed_at: "2026-09-01T00:00:00.000Z",
              },
            },
          },
          error: null,
        });
        await Promise.resolve();
      });

      expect(
        screen.queryByText("Stale permanent runtime mounted"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Enter no-signup preview" }),
      ).toBeVisible();
    },
  );

  it("ignores a late OTP request after a different confirmed actor signs in", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    let resolveRequest!: (value: { data: object; error: null }) => void;
    const Child = () => {
      const identity = useDemoAuthenticatedIdentity();
      return <div>Hosted as {identity?.email ?? "anonymous"}</div>;
    };
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
          signInWithOtp: vi.fn(
            () =>
              new Promise<Parameters<typeof resolveRequest>[0]>((resolve) => {
                resolveRequest = resolve;
              }),
          ),
        },
      },
    } as never);
    const user = userEvent.setup();

    render(
      <DemoEntry>
        <Child />
      </DemoEntry>,
    );
    await user.click(await screen.findByRole("button", { name: "Account sign-in" }));
    await user.type(screen.getByLabelText("Email"), "first@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "replacement-actor",
          email: "replacement@example.com",
          is_anonymous: false,
          email_confirmed_at: "2026-09-01T00:00:00.000Z",
        },
      }),
    );
    expect(screen.getByText("Hosted as replacement@example.com")).toBeVisible();

    await act(async () => {
      resolveRequest({ data: {}, error: null });
      await Promise.resolve();
    });

    expect(screen.getByText("Hosted as replacement@example.com")).toBeVisible();
    expect(screen.queryByLabelText("Six-digit code")).not.toBeInTheDocument();
  });

  it("ignores a late OTP verification failure after a different actor signs in", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    let resolveVerification!: (value: {
      data: { session: null; user: null };
      error: { message: string };
    }) => void;
    const Child = () => {
      const identity = useDemoAuthenticatedIdentity();
      return <div>Hosted as {identity?.email ?? "anonymous"}</div>;
    };
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
          signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
          verifyOtp: vi.fn(
            () =>
              new Promise<Parameters<typeof resolveVerification>[0]>((resolve) => {
                resolveVerification = resolve;
              }),
          ),
        },
      },
    } as never);
    const user = userEvent.setup();

    render(
      <DemoEntry>
        <Child />
      </DemoEntry>,
    );
    await user.click(await screen.findByRole("button", { name: "Account sign-in" }));
    await user.type(screen.getByLabelText("Email"), "first@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await act(async () =>
      emitAuthEvent?.("SIGNED_IN", {
        user: {
          id: "replacement-actor",
          email: "replacement@example.com",
          is_anonymous: false,
          email_confirmed_at: "2026-09-01T00:00:00.000Z",
        },
      }),
    );
    expect(screen.getByText("Hosted as replacement@example.com")).toBeVisible();

    await act(async () => {
      resolveVerification({
        data: { session: null, user: null },
        error: { message: "expired" },
      });
      await Promise.resolve();
    });

    expect(screen.getByText("Hosted as replacement@example.com")).toBeVisible();
    expect(screen.queryByLabelText("Six-digit code")).not.toBeInTheDocument();
  });

  it.each(["SIGNED_OUT", "INITIAL_SESSION"])(
    "returns to the entry gate when %s supersedes an OTP request from the empty actor state",
    async (event) => {
      let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
      let resolveRequest!: (value: { data: object; error: null }) => void;
      vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
        ok: true,
        client: {
          auth: {
            getSession: vi.fn(async () => ({
              data: { session: null },
              error: null,
            })),
            onAuthStateChange: vi.fn((callback) => {
              emitAuthEvent = callback;
              return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
            signInWithOtp: vi.fn(
              () =>
                new Promise<Parameters<typeof resolveRequest>[0]>((resolve) => {
                  resolveRequest = resolve;
                }),
            ),
          },
        },
      } as never);
      const user = userEvent.setup();

      render(
        <DemoEntry>
          <div>Stale permanent runtime mounted</div>
        </DemoEntry>,
      );
      await user.click(
        await screen.findByRole("button", { name: "Account sign-in" }),
      );
      await user.type(screen.getByLabelText("Email"), "old@example.com");
      await user.click(
        screen.getByRole("button", { name: "Email me a code" }),
      );
      expect(
        await screen.findByText("Sending a six-digit code…"),
      ).toBeVisible();

      await act(async () => emitAuthEvent?.(event, null));
      await act(async () => {
        resolveRequest({ data: {}, error: null });
        await Promise.resolve();
      });

      expect(
        screen.getByRole("button", { name: "Account sign-in" }),
      ).toBeVisible();
      expect(screen.queryByLabelText("Six-digit code")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Stale permanent runtime mounted"),
      ).not.toBeInTheDocument();
    },
  );

  it("returns to the entry gate when sign-out supersedes OTP verification from the empty actor state", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    let resolveVerification!: (value: {
      data: {
        session: { access_token: string };
        user: {
          id: string;
          email: string;
          is_anonymous: false;
        };
      };
      error: null;
    }) => void;
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
          signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
          verifyOtp: vi.fn(
            () =>
              new Promise<Parameters<typeof resolveVerification>[0]>((resolve) => {
                resolveVerification = resolve;
              }),
          ),
        },
      },
    } as never);
    const user = userEvent.setup();

    render(
      <DemoEntry>
        <div>Stale permanent runtime mounted</div>
      </DemoEntry>,
    );
    await user.click(await screen.findByRole("button", { name: "Account sign-in" }));
    await user.type(screen.getByLabelText("Email"), "old@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText("Verifying your code…")).toBeVisible();

    await act(async () => emitAuthEvent?.("SIGNED_OUT", null));
    await act(async () => {
      resolveVerification({
        data: {
          session: { access_token: "old.payload.signature" },
          user: {
            id: "old-actor",
            email: "old@example.com",
            is_anonymous: false,
          },
        },
        error: null,
      });
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Account sign-in" })).toBeVisible();
    expect(screen.queryByLabelText("Six-digit code")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale permanent runtime mounted")).not.toBeInTheDocument();
  });

  it("invalidates the old runtime even when recovery storage removal throws", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    const cleanup = vi.fn();
    const Child = () => {
      const identity = useDemoAuthenticatedIdentity();
      useEffect(() => cleanup, []);
      return <div>Hosted as {identity?.email ?? "anonymous"}</div>;
    };
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "first-actor",
                  email: "first@example.com",
                  is_anonymous: false,
                  email_confirmed_at: "2026-09-01T00:00:00.000Z",
                },
              },
            },
            error: null,
          })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <Child />
      </DemoEntry>,
    );
    expect(await screen.findByText("Hosted as first@example.com")).toBeVisible();
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("Storage denied", "SecurityError");
      });

    try {
      await act(async () => {
        try {
          emitAuthEvent?.("SIGNED_IN", {
            user: {
              id: "second-actor",
              email: "second@example.com",
              is_anonymous: false,
              email_confirmed_at: "2026-09-01T00:00:00.000Z",
            },
          });
        } catch {
          // The assertion below proves storage cannot stop in-memory teardown.
        }
      });
    } finally {
      removeItem.mockRestore();
    }

    expect(screen.getByText("Hosted as second@example.com")).toBeVisible();
    expect(screen.queryByText("Hosted as first@example.com")).not.toBeInTheDocument();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("recovers when the same actor changes from unconfirmed to confirmed", async () => {
    let emitAuthEvent: ((event: string, session: unknown) => void) | undefined;
    const Child = () => {
      const identity = useDemoAuthenticatedIdentity();
      return <div>Hosted as {identity?.email ?? "anonymous"}</div>;
    };
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "same-actor",
                  email: "same@example.com",
                  is_anonymous: false,
                  email_confirmed_at: null,
                },
              },
            },
            error: null,
          })),
          onAuthStateChange: vi.fn((callback) => {
            emitAuthEvent = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
        },
      },
    } as never);

    render(
      <DemoEntry>
        <Child />
      </DemoEntry>,
    );
    await waitFor(() => expect(emitAuthEvent).toBeTypeOf("function"));
    expect(screen.queryByText("Hosted as same@example.com")).not.toBeInTheDocument();

    await act(async () =>
      emitAuthEvent?.("USER_UPDATED", {
        user: {
          id: "same-actor",
          email: "same@example.com",
          is_anonymous: false,
          email_confirmed_at: "2026-09-01T00:00:00.000Z",
        },
      }),
    );

    expect(screen.getByText("Hosted as same@example.com")).toBeVisible();
  });

  it("offers an actionable verification gate instead of a dead unconfirmed preview CTA", async () => {
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {
        auth: {
          getSession: vi.fn(async () => ({
            data: {
              session: {
                user: {
                  id: "unconfirmed-actor",
                  email: "unconfirmed@example.com",
                  is_anonymous: false,
                  email_confirmed_at: null,
                },
              },
            },
            error: null,
          })),
        },
      },
    } as never);
    const user = userEvent.setup();

    render(
      <DemoEntry>
        <div>Hosted preview mounted</div>
      </DemoEntry>,
    );

    expect(
      await screen.findByText(/current CommandCanvas session is not confirmed/i),
    ).toBeVisible();
    const preview = screen.getByRole("button", {
      name: "Enter no-signup preview",
    });
    expect(preview).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Verify account with email code" }));
    expect(screen.getByLabelText("Email")).toHaveValue("unconfirmed@example.com");
  });
});
