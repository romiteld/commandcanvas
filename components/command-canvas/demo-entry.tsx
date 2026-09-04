"use client";

import {
  useEffect,
  Fragment,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";

import { clearStoredDemoRoom } from "@/lib/demo/room-link";
import {
  DemoAuthenticatedIdentityProvider,
  type DemoAuthenticatedIdentity,
} from "@/components/command-canvas/demo-auth-context";
import {
  requestEmailOtp,
  verifyEmailOtp,
  type PasswordlessAuthClient,
} from "@/lib/supabase/passwordless";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";
import { normalizedEmailSchema } from "@/lib/supabase/meeting-contracts";
import { useDocumentWebMcpTarget } from "@/lib/webmcp/use-document-target";

export const DEMO_ENTRY_ACCEPTED_KEY = "commandcanvas.demo-entry.accepted.v1";
const DEMO_ENTRY_ACCEPTED_EVENT = "commandcanvas:demo-entry-accepted";

interface DemoEntrySession {
  user: {
    id: string;
    email?: string;
    is_anonymous?: boolean;
    email_confirmed_at?: string | null;
  };
}

interface DemoEntryAuthClient extends PasswordlessAuthClient {
  auth: PasswordlessAuthClient["auth"] & {
    getSession: () => Promise<{
      data: { session: DemoEntrySession | null };
      error: { message: string } | null;
    }>;
    onAuthStateChange?: (
      callback: (event: string, session: DemoEntrySession | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
  };
}

type EntryPhase =
  | { kind: "checking" }
  | { kind: "choice"; permanentEmail: string | null; error: string | null }
  | { kind: "email"; email: string; error: string | null }
  | { kind: "otp"; email: string; error: string | null }
  | { kind: "working"; email: string; message: string };

type EntryActorKind = "none" | "anonymous" | "permanent" | "unconfirmed";

interface EntryActorState {
  actorId: string | null;
  kind: EntryActorKind;
  email: string | null;
  identity: DemoAuthenticatedIdentity | null;
}

const EMPTY_ENTRY_ACTOR: EntryActorState = {
  actorId: null,
  kind: "none",
  email: null,
  identity: null,
};

function readConfirmedIdentity(session: DemoEntrySession | null): DemoAuthenticatedIdentity | null {
  const user = session?.user;
  const parsedEmail = normalizedEmailSchema.safeParse(user?.email);
  if (
    !user ||
    user.is_anonymous === true ||
    typeof user.email_confirmed_at !== "string" ||
    user.email_confirmed_at.trim() === "" ||
    !parsedEmail.success
  )
    return null;
  return { actorId: user.id, email: parsedEmail.data };
}

function readActorKind(session: DemoEntrySession | null): EntryActorKind {
  if (!session?.user) return "none";
  if (session.user.is_anonymous === true) return "anonymous";
  return readConfirmedIdentity(session) ? "permanent" : "unconfirmed";
}

function readActorState(session: DemoEntrySession | null): EntryActorState {
  const identity = readConfirmedIdentity(session);
  const parsedEmail = normalizedEmailSchema.safeParse(session?.user.email);
  return {
    actorId: session?.user.id ?? null,
    kind: readActorKind(session),
    email: parsedEmail.success ? parsedEmail.data : null,
    identity,
  };
}

function sameActorState(left: EntryActorState, right: EntryActorState) {
  return (
    left.actorId === right.actorId &&
    left.kind === right.kind &&
    left.email === right.email
  );
}

function subscribeToDemoEntry(onChange: () => void) {
  window.addEventListener(DEMO_ENTRY_ACCEPTED_EVENT, onChange);
  return () => window.removeEventListener(DEMO_ENTRY_ACCEPTED_EVENT, onChange);
}

function readStoredDemoEntry() {
  try {
    return window.sessionStorage.getItem(DEMO_ENTRY_ACCEPTED_KEY) === "accepted";
  } catch {
    return false;
  }
}

function subscribeToDemoRoute(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function readSignInIntent() {
  try {
    return new URLSearchParams(window.location.search).get("signin") === "1";
  } catch {
    return false;
  }
}

function subscribeToClientMount() {
  return () => undefined;
}

function readMountedClient() {
  return true;
}

function readMountedServer() {
  return false;
}

export function returnToDemoSignIn() {
  try {
    clearStoredDemoRoom(window.sessionStorage);
    window.sessionStorage.removeItem(DEMO_ENTRY_ACCEPTED_KEY);
  } catch {
    // The route gate remains authoritative when browser storage is unavailable.
  }
  replaceDemoPath("/demo?signin=1");
  window.location.reload();
}

function replaceDemoPath(path: string) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function DemoEntry({ children }: { children: ReactNode }) {
  const storedAccepted = useSyncExternalStore(
    subscribeToDemoEntry,
    readStoredDemoEntry,
    () => false,
  );
  const signInIntent = useSyncExternalStore(
    subscribeToDemoRoute,
    readSignInIntent,
    () => false,
  );
  const [memoryAccepted, setMemoryAccepted] = useState(false);
  const [acceptanceRevoked, setAcceptanceRevoked] = useState(false);
  const [actorState, setActorState] = useState<EntryActorState>(EMPTY_ENTRY_ACTOR);
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  const [phase, setPhase] = useState<EntryPhase>({
    kind: "choice",
    permanentEmail: null,
    error: null,
  });
  const clientRef = useRef<DemoEntryAuthClient | null>(null);
  const lifecycleAbortRef = useRef<AbortController | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    readMountedClient,
    readMountedServer,
  );
  const webMcpRegistrationSurfaceDetected = useDocumentWebMcpTarget() !== null;
  const accepted = !acceptanceRevoked && (storedAccepted || memoryAccepted);
  const acceptedRef = useRef(accepted);
  const currentActorStateRef = useRef<EntryActorState>(EMPTY_ENTRY_ACTOR);
  const authGenerationRef = useRef(0);

  useEffect(() => {
    acceptedRef.current = accepted;
  }, [accepted]);

  useEffect(() => {
    const lifecycle = new AbortController();
    lifecycleAbortRef.current = lifecycle;
    let active = true;

    async function recoverEntryIdentity() {
      const recoveryGeneration = authGenerationRef.current;
      const clientResult = createBrowserSupabaseClient({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      });
      if (!clientResult.ok) {
        if (!lifecycle.signal.aborted && active) {
          clientRef.current = null;
          setPhase({
            kind: "choice",
            permanentEmail: null,
            error: "Sign-in is temporarily unavailable in this browser.",
          });
        }
        return;
      }
      const client = clientResult.client as unknown as DemoEntryAuthClient;
      clientRef.current = client;
      try {
        const current = await client.auth.getSession();
        if (
          lifecycle.signal.aborted ||
          !active ||
          authGenerationRef.current !== recoveryGeneration
        )
          return;
        clientRef.current = client;
        const nextActor = current.error
          ? EMPTY_ENTRY_ACTOR
          : readActorState(current.data.session);
        if (!sameActorState(currentActorStateRef.current, nextActor))
          authGenerationRef.current += 1;
        currentActorStateRef.current = nextActor;
        setActorState(nextActor);
        setPhase({
          kind: "choice",
          permanentEmail: nextActor.identity?.email ?? null,
          error: current.error
            ? "Your current CommandCanvas session could not be checked."
            : null,
        });
      } catch {
        if (
          !lifecycle.signal.aborted &&
          active &&
          authGenerationRef.current === recoveryGeneration
        ) {
          clientRef.current = null;
          setPhase({
            kind: "choice",
            permanentEmail: null,
            error: "Your current CommandCanvas session could not be checked.",
          });
        }
      }
    }

    void recoverEntryIdentity();
    const client = clientRef.current;
    const subscription = client?.auth.onAuthStateChange?.((event, session) => {
      if (lifecycle.signal.aborted) return;
      const nextActor = readActorState(session);
      const supersedesPendingAuthWork =
        event === "SIGNED_OUT" || event === "INITIAL_SESSION";
      if (supersedesPendingAuthWork) authGenerationRef.current += 1;
      if (sameActorState(nextActor, currentActorStateRef.current)) {
        if (event === "INITIAL_SESSION") {
          setPhase({
            kind: "choice",
            permanentEmail: nextActor.identity?.email ?? null,
            error: null,
          });
          return;
        }
        if (event !== "SIGNED_OUT") return;
      }
      const previousActor = currentActorStateRef.current;
      currentActorStateRef.current = nextActor;
      if (!supersedesPendingAuthWork) authGenerationRef.current += 1;
      if (
        previousActor.kind === "none" &&
        acceptedRef.current &&
        nextActor.kind === "anonymous"
      ) {
        setActorState(nextActor);
        return;
      }

      acceptedRef.current = false;
      setAcceptanceRevoked(true);
      setMemoryAccepted(false);
      setActorState(nextActor);
      setRuntimeEpoch((epoch) => epoch + 1);
      setPhase({
        kind: "choice",
        permanentEmail: nextActor.identity?.email ?? null,
        error: null,
      });
      try {
        const storage = window.sessionStorage;
        clearStoredDemoRoom(storage);
        storage.removeItem(DEMO_ENTRY_ACCEPTED_KEY);
        window.dispatchEvent(new Event(DEMO_ENTRY_ACCEPTED_EVENT));
      } catch {
        // In-memory revocation remains authoritative when storage is disabled.
      }
    });
    return () => {
      active = false;
      lifecycle.abort();
      if (lifecycleAbortRef.current === lifecycle)
        lifecycleAbortRef.current = null;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (phase.kind === "email" && phase.error)
      emailInputRef.current?.focus();
    if (phase.kind === "otp" && phase.error)
      codeInputRef.current?.focus();
  }, [phase]);

  function acceptEntry() {
    if (currentActorStateRef.current.kind === "unconfirmed") return;
    acceptedRef.current = true;
    setAcceptanceRevoked(false);
    try {
      window.sessionStorage.setItem(DEMO_ENTRY_ACCEPTED_KEY, "accepted");
      window.dispatchEvent(new Event(DEMO_ENTRY_ACCEPTED_EVENT));
    } catch {
      setMemoryAccepted(true);
    }
  }

  function clearEntryRecovery() {
    acceptedRef.current = false;
    setAcceptanceRevoked(true);
    setMemoryAccepted(false);
    try {
      clearStoredDemoRoom(window.sessionStorage);
      window.sessionStorage.removeItem(DEMO_ENTRY_ACCEPTED_KEY);
      window.dispatchEvent(new Event(DEMO_ENTRY_ACCEPTED_EVENT));
    } catch {
      // The new permanent session remains valid even when tab storage is unavailable.
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind !== "email") return;
    const client = clientRef.current;
    const signal = lifecycleAbortRef.current?.signal;
    if (!client || !signal || signal.aborted) {
      setPhase({
        kind: "email",
        email: phase.email,
        error: "Sign-in is temporarily unavailable in this browser.",
      });
      return;
    }
    const previous = phase;
    const operationGeneration = authGenerationRef.current;
    setPhase({ kind: "working", email: previous.email, message: "Sending a six-digit code…" });
    const result = await requestEmailOtp(client, previous.email);
    if (
      signal.aborted ||
      authGenerationRef.current !== operationGeneration
    )
      return;
    if (!result.ok) {
      setPhase({ kind: "email", email: previous.email, error: result.message });
      return;
    }
    setPhase({ kind: "otp", email: result.email, error: null });
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind !== "otp") return;
    const client = clientRef.current;
    const signal = lifecycleAbortRef.current?.signal;
    if (!client || !signal || signal.aborted) return;
    const previous = phase;
    const operationGeneration = authGenerationRef.current;
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setPhase({ kind: "working", email: previous.email, message: "Verifying your code…" });
    const result = await verifyEmailOtp(client, previous.email, code);
    if (signal.aborted) return;
    if (!result.ok) {
      if (authGenerationRef.current !== operationGeneration) return;
      setPhase({ kind: "otp", email: previous.email, error: result.message });
      return;
    }
    const verifiedActor: EntryActorState = {
      actorId: result.value.user.id,
      kind: "permanent",
      email: result.value.email,
      identity: { actorId: result.value.user.id, email: result.value.email },
    };
    if (
      authGenerationRef.current !== operationGeneration &&
      !sameActorState(currentActorStateRef.current, verifiedActor)
    )
      return;
    clearEntryRecovery();
    replaceDemoPath("/demo");
    if (!sameActorState(currentActorStateRef.current, verifiedActor))
      authGenerationRef.current += 1;
    currentActorStateRef.current = verifiedActor;
    setActorState(verifiedActor);
    setPhase({ kind: "choice", permanentEmail: result.value.email, error: null });
    acceptEntry();
  }

  const allowAnonymousResume =
    !signInIntent &&
    accepted &&
    phase.kind === "choice" &&
    (actorState.kind === "none" || actorState.kind === "anonymous");
  if (allowAnonymousResume)
    return (
      <DemoAuthenticatedIdentityProvider identity={actorState.identity}>
        <Fragment key={runtimeEpoch}>{children}</Fragment>
      </DemoAuthenticatedIdentityProvider>
    );
  if (
    !signInIntent &&
    phase.kind === "choice" &&
    phase.permanentEmail !== null
  )
    return (
      <DemoAuthenticatedIdentityProvider identity={actorState.identity}>
        <Fragment key={runtimeEpoch}>{children}</Fragment>
      </DemoAuthenticatedIdentityProvider>
    );

  return (
    <main className="demo-gate demo-entry" aria-labelledby="demo-entry-title">
      <span className="demo-gate-mark" aria-hidden="true">
        CC
      </span>
      <p className="eyebrow">CommandCanvas / choose an entry</p>
      <h1 id="demo-entry-title">Choose how to enter CommandCanvas</h1>
      <p>
        Sign in for durable rooms, invitations, and your encrypted saved OpenAI
        key. In the ChatGPT desktop app, the surrounding compatible agent host
        uses its signed-in ChatGPT account for WebMCP tools. Those page tools
        operate on CommandCanvas state and do not receive the ChatGPT credential.
      </p>
      <p className="demo-entry-site-tools" role="status">
        {webMcpRegistrationSurfaceDetected
          ? "A WebMCP registration surface was detected in this tab. After entry, CommandCanvas automatically registers its tools when the live canvas is ready, so compatible agents can discover and invoke them without opening the activity drawer. The activity drawer only inspects registration and activity. Surface detection is not completed registration or invocation evidence; an actual invocation and receipt are shown separately after you enter."
          : "This browser session has not exposed a WebMCP registration surface. No additional ChatGPT sign-in is required; the preview still works with visible canvas controls."}
      </p>
      {phase.kind === "checking" ? (
        <>
          <p role="status">Checking your CommandCanvas session…</p>
          <button className="demo-entry-primary" disabled type="button">
            Enter no-signup preview
          </button>
        </>
      ) : phase.kind === "email" ? (
        <form className="demo-entry-form" onSubmit={requestCode}>
          <label>
            Email
            <input
              autoComplete="email"
            inputMode="email"
            name="email"
            ref={emailInputRef}
              required
              type="email"
              value={phase.email}
              onChange={(event) =>
                setPhase({ kind: "email", email: event.target.value, error: null })
              }
            />
          </label>
          {phase.error ? <p role="alert">{phase.error}</p> : null}
          <button className="demo-entry-primary" disabled={!mounted} type="submit">
            Email me a code
          </button>
          <button
            className="demo-entry-secondary"
            type="button"
            onClick={() =>
              setPhase({ kind: "choice", permanentEmail: null, error: null })
            }
          >
            Back
          </button>
        </form>
      ) : phase.kind === "otp" ? (
        <form className="demo-entry-form" onSubmit={verifyCode}>
          <p>Enter the six-digit code sent to {phase.email}.</p>
          <label>
            Six-digit code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
            maxLength={6}
            name="code"
            ref={codeInputRef}
              pattern="[0-9]{6}"
              required
            />
          </label>
          {phase.error ? <p role="alert">{phase.error}</p> : null}
          <button className="demo-entry-primary" disabled={!mounted} type="submit">
            Verify code
          </button>
          <button
            className="demo-entry-secondary"
            type="button"
            onClick={() => setPhase({ kind: "email", email: phase.email, error: null })}
          >
            Use a different email
          </button>
        </form>
      ) : phase.kind === "working" ? (
        <p role="status">{phase.message}</p>
      ) : (
        <div className="demo-entry-actions">
          {actorState.kind === "unconfirmed" ? (
            <>
              <p role="alert">
                Your current CommandCanvas session is not confirmed. Verify the
                account before entering a room.
              </p>
              <button
                className="demo-entry-primary"
                disabled={!mounted}
                type="button"
                onClick={() =>
                  setPhase({
                    kind: "email",
                    email: actorState.email ?? "",
                    error: null,
                  })
                }
              >
                Verify account with email code
              </button>
              <button
                className="demo-entry-secondary"
                disabled
                type="button"
              >
                Enter no-signup preview
              </button>
            </>
          ) : signInIntent ? (
            <button
              className="demo-entry-primary"
              disabled={!mounted}
              type="button"
              onClick={() => setPhase({ kind: "email", email: "", error: null })}
            >
              Sign in with email code
            </button>
          ) : (
            <button
              className="demo-entry-primary"
              disabled={!mounted}
              type="button"
              onClick={acceptEntry}
            >
              Enter no-signup preview
            </button>
          )}
          {!signInIntent ? (
            <button
              className="demo-entry-secondary"
              disabled={!mounted}
              type="button"
              onClick={() => setPhase({ kind: "email", email: "", error: null })}
            >
              Account sign-in
            </button>
          ) : null}
        </div>
      )}
      {phase.kind === "choice" && phase.error ? <p role="alert">{phase.error}</p> : null}
      <p className="demo-entry-boundary">
        A capped demo room is allocated only after you continue. No-signup
        visitors receive an anonymous Supabase identity and never receive an
        owner key. A permanent email-authenticated CommandCanvas identity can
        automatically use only its own encrypted credential through server-side
        Supabase Vault. The preview cannot send production email.
      </p>
    </main>
  );
}
