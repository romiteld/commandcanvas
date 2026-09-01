"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { StoreApi } from "zustand";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import type { WebMcpSurfaceState } from "@/components/command-canvas/chatgpt-command-surface";
import type { SpatialCameraControllerPreferences } from "@/components/command-canvas/spatial-camera-control";
import { MeetingFilmstrip } from "@/components/command-canvas/meeting-filmstrip";
import {
  MeetingPacketWorkflowPanel,
  type MeetingPacketWorkflowController,
  useMeetingPacketWorkflow,
  webMcpPacketFailure,
} from "@/components/command-canvas/meeting-packet-workflow";
import { createCanvasStore, type CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { CanvasPoint } from "@/lib/canvas/coordinates";
import { createSharedCameraHandController } from "@/lib/gesture/shared-camera-controller";
import type { MeetingMediaClient } from "@/lib/meeting/media-controller";
import {
  createBrowserOpenAiCredentialApi,
  type BrowserOpenAiCredentialApi,
  type BrowserOpenAiCredentialStatus,
} from "@/lib/openai-credentials/browser-api";
import { createBrowserPacketApi } from "@/lib/packets/browser-api";
import {
  createDemoRoomSession,
  type DemoRoomRealtimeClient,
  type DemoRoomSession,
  type DemoRoomSnapshot,
} from "@/lib/demo/room-session";
import { createBrowserRoomApi } from "@/lib/supabase/room-api";
import type { BrowserRoomClient } from "@/lib/supabase/browser-room";
import { loadOwnRoomMembership } from "@/lib/supabase/browser-room";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";
import {
  createBrowserMeetingApi,
  type BrowserMeetingInvitationValue,
} from "@/lib/supabase/meeting-api";
import { pollInvitationDelivery } from "@/lib/supabase/invitation-delivery-poller";
import { readAndScrubMeetingInvite } from "@/lib/supabase/meeting-invite-fragment";
import { requestEmailOtp, verifyEmailOtp } from "@/lib/supabase/passwordless";
import { createBrowserUserProfileApi } from "@/lib/user-profiles/browser-api";
import { createBrowserSketchTransformApi } from "@/lib/vision/browser-api";
import { createCanvasSketchTransformer } from "@/lib/vision/canvas-transform";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import {
  WebMcpRegistry,
  type WebMcpExecutionEvent,
  type WebMcpRegistrationTarget,
} from "@/lib/webmcp/registry";
import { upsertWebMcpExecutionActivity } from "@/lib/webmcp/execution-activity";
import { useDocumentWebMcpTarget } from "@/lib/webmcp/use-document-target";

type BrowserClient = SupabaseClient;

export type MeetingLobbyState =
  | { phase: "initializing" }
  | { phase: "email"; invited: boolean; error?: string }
  | { phase: "otp"; invited: boolean; email: string; error?: string }
  | {
      phase: "invite_account";
      email: string;
      message: string;
      error?: string;
    }
  | {
      phase: "host_form";
      email: string;
      displayName?: string;
      color?: string;
      roomName?: string;
      error?: string;
    }
  | { phase: "working"; message: string }
  | { phase: "error"; message: string };

interface MeetingRuntime {
  client: BrowserClient;
  session: DemoRoomSession;
  store: StoreApi<CanvasStoreState>;
  snapshot: DemoRoomSnapshot;
}

type InvitationDeliveryStatus =
  BrowserMeetingInvitationValue["delivery"]["status"];

const INVITATION_DELIVERY_LABELS: Record<InvitationDeliveryStatus, string> = {
  created: "Invitation ready to send",
  sending: "Email submission in progress",
  preview_only: "Preview only: email not sent",
  reconciling: "Email submission being reconciled",
  submitted: "Email submitted: delivery pending",
  delivered: "Email delivered",
  bounced: "Email bounced",
  complained: "Recipient reported this email",
  failed: "Email delivery failed",
  suppressed: "Email suppressed",
};

type RecoveredBrowserSession =
  | { ok: true; session: Session | null }
  | { ok: false };

async function recoverBrowserSession(
  client: BrowserClient,
  options: { refreshAfterThrown?: boolean } = {},
): Promise<RecoveredBrowserSession> {
  try {
    const current = await client.auth.getSession();
    if (!current.error) return { ok: true, session: current.data.session };
  } catch {
    // A transient browser/session-store failure gets one explicit refresh.
    if (options.refreshAfterThrown === false) return { ok: false };
  }
  try {
    const refreshed = await client.auth.refreshSession();
    return refreshed.error
      ? { ok: false }
      : { ok: true, session: refreshed.data.session };
  } catch {
    return { ok: false };
  }
}

export function MeetingCommandCanvas({
  privateGpuRelayEnabled = false,
}: {
  privateGpuRelayEnabled?: boolean;
}) {
  const [lobby, setLobby] = useState<MeetingLobbyState>({ phase: "initializing" });
  const [runtime, setRuntime] = useState<MeetingRuntime | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] =
    useState<BrowserMeetingInvitationValue | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy secure link");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [savedOpenAiCredential, setSavedOpenAiCredential] =
    useState<BrowserOpenAiCredentialStatus>({ configured: false });
  const [savedOpenAiCredentialBusy, setSavedOpenAiCredentialBusy] =
    useState(false);
  const [savedOpenAiCredentialError, setSavedOpenAiCredentialError] =
    useState<string | null>(null);
  const [useSavedOpenAiCredential, setUseSavedOpenAiCredential] =
    useState(false);
  const openAiApiKeyRef = useRef("");
  const useSavedOpenAiCredentialRef = useRef(false);
  const openAiCredentialApiRef =
    useRef<BrowserOpenAiCredentialApi | null>(null);
  const clientRef = useRef<BrowserClient | null>(null);
  const inviteTokenRef = useRef<string | null>(null);
  const inviteReadRef = useRef(false);
  const lifecycleAbortRef = useRef<AbortController | null>(null);
  const invitationPollAbortRef = useRef<AbortController | null>(null);
  const roomUnsubscribeRef = useRef<(() => void) | null>(null);
  const meetingMediaStreamRef = useRef<MediaStream | null>(null);
  const activeRuntimeSessionRef = useRef<DemoRoomSession | null>(null);
  const disposedRuntimeSessionsRef = useRef(new WeakSet<DemoRoomSession>());
  const webMcpRegistryRef = useRef<WebMcpRegistry | null>(null);
  const webMcpTarget = useDocumentWebMcpTarget();
  const [webMcpStatus, setWebMcpStatus] = useState({
    value: "Checking Site Tools…",
    tone: "working" as "idle" | "working" | "ready",
  });
  const [webMcpSurfaceState, setWebMcpSurfaceState] =
    useState<WebMcpSurfaceState>({ status: "checking" });
  const [webMcpExecutionActivity, setWebMcpExecutionActivity] = useState<
    readonly WebMcpExecutionEvent[]
  >([]);

  const selectSavedOpenAiCredential = useCallback((value: boolean) => {
    useSavedOpenAiCredentialRef.current = value;
    setUseSavedOpenAiCredential(value);
  }, []);

  useEffect(() => {
    const lifecycle = new AbortController();
    const { signal } = lifecycle;
    lifecycleAbortRef.current = lifecycle;
    const cleanup = () => {
      lifecycle.abort();
      invitationPollAbortRef.current?.abort();
      invitationPollAbortRef.current = null;
      openAiApiKeyRef.current = "";
      useSavedOpenAiCredentialRef.current = false;
      openAiCredentialApiRef.current = null;
      if (lifecycleAbortRef.current === lifecycle)
        lifecycleAbortRef.current = null;
      roomUnsubscribeRef.current?.();
      roomUnsubscribeRef.current = null;
    };
    // This is deliberately the first browser action. The fragment never enters
    // an HTTP request, and is removed before constructing Supabase or app APIs.
    const inviteToken = readMeetingInviteOnce(
      { read: inviteReadRef, token: inviteTokenRef },
      {
        href: window.location.href,
        replaceState: (data, unused, path) =>
          window.history.replaceState(data, unused, path),
      },
    );

    const clientResult = createBrowserSupabaseClient({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!clientResult.ok) {
      void Promise.resolve().then(() => {
        if (!signal.aborted)
          setLobby({ phase: "error", message: clientResult.message });
      });
      return cleanup;
    }
    const client = clientResult.client as BrowserClient;
    clientRef.current = client;

    void (async () => {
      const recovered = await recoverBrowserSession(client);
      if (signal.aborted) return;
      if (!recovered.ok) {
        setLobby({
          phase: "email",
          invited: Boolean(inviteToken),
          error: "Your session could not be refreshed. Request a new code.",
        });
        return;
      }
      const session = recovered.session;
      const permanent =
        session?.user?.is_anonymous !== true &&
        typeof session?.user?.email === "string" &&
        Boolean(session.user.email_confirmed_at);
      if (permanent && session) {
        if (inviteToken) {
          await acceptAndEnter(
            client,
            session.access_token,
            inviteToken,
            signal,
            session.user.email!,
          );
          return;
        }
        const roomId = new URL(window.location.href).searchParams.get("room");
        if (roomId) {
          const membership = await loadOwnRoomMembership(
            client as unknown as BrowserRoomClient,
            roomId,
            session.user.id,
          );
          if (signal.aborted) return;
          if (membership.ok) {
            await enterRoom(
              client,
              session.access_token,
              roomId,
              membership.membership.role,
              signal,
            );
            return;
          }
        }
        await showHostForm(
          session.access_token,
          session.user.email!,
          signal,
        );
        return;
      }
      setLobby({ phase: "email", invited: Boolean(inviteToken) });
    })();

    return cleanup;
    // The lobby bootstrap is intentionally one browser-lifecycle handshake.
    // Re-running it after callback identity changes could consume an invite or
    // create duplicate authenticated room work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function showHostForm(
    accessToken: string,
    email: string,
    signal: AbortSignal,
    draft?: Pick<
      Extract<MeetingLobbyState, { phase: "host_form" }>,
      "displayName" | "color" | "roomName"
    >,
  ) {
    const result = await createBrowserUserProfileApi({ accessToken }).load(signal);
    if (signal.aborted) return;
    if (!result.ok) {
      setLobby({
        phase: "host_form",
        email,
        ...draft,
        error: result.error.message,
      });
      return;
    }
    setLobby({
      phase: "host_form",
      email,
      displayName: draft?.displayName ?? result.value?.displayName,
      color: draft?.color ?? result.value?.color,
      roomName: draft?.roomName,
    });
  }

  function clearAccountScopedCredentialState() {
    openAiApiKeyRef.current = "";
    setOpenAiApiKey("");
    openAiCredentialApiRef.current = null;
    setSavedOpenAiCredential({ configured: false });
    setSavedOpenAiCredentialError(null);
    selectSavedOpenAiCredential(false);
  }

  async function acceptAndEnter(
      client: BrowserClient,
      accessToken: string,
      token: string,
      signal: AbortSignal,
      signedInEmail: string,
    ) {
      if (signal.aborted) return;
      setLobby({ phase: "working", message: "Verifying your invitation…" });
      const api = createBrowserMeetingApi({ accessToken });
      const accepted = await api.acceptInvitation({ token }, signal);
      if (signal.aborted) return;
      if (!accepted.ok) {
        if (
          accepted.error.code === "invitation_unavailable" &&
          inviteTokenRef.current === token
        ) {
          setLobby({
            phase: "invite_account",
            email: signedInEmail,
            message: accepted.error.message,
          });
          return;
        }
        setLobby({ phase: "error", message: accepted.error.message });
        return;
      }
      inviteTokenRef.current = null;
      await enterRoom(
        client,
        accessToken,
        accepted.value.roomId,
        "participant",
        signal,
      );
  }

  async function enterRoom(
      client: BrowserClient,
      accessToken: string,
      roomId: string,
      role: "host" | "participant",
      signal: AbortSignal,
    ) {
      if (signal.aborted) return;
      setLobby({ phase: "working", message: "Opening the shared workspace…" });
      let store: StoreApi<CanvasStoreState> | null = null;
      const session = createDemoRoomSession({
        authClient: client,
        roomDataClient: client as unknown as BrowserRoomClient,
        realtimeClient: client as unknown as DemoRoomRealtimeClient,
        createRoomApi: (token) => createBrowserRoomApi({ accessToken: token }),
        createSketchTransformApi: (token) =>
          createBrowserSketchTransformApi({
            accessToken: token,
            getOpenAiApiKey: () => openAiApiKeyRef.current,
            getUseSavedOpenAiCredential: () =>
              useSavedOpenAiCredentialRef.current,
          }),
        createPacketApi: (token) => createBrowserPacketApi({ accessToken: token }),
        hydrateCanvas: (state) => {
          if (!store)
            store = createCanvasStore(state.roomId, {
              actor: {
                id: "browser-room-member",
                displayName: "Room member",
                type: "human",
              },
              createId: (prefix) => `${prefix}-${crypto.randomUUID()}`,
              now: () => new Date().toISOString(),
            });
          return store.getState().hydrateCanvas(state);
        },
        createCommandId: () => crypto.randomUUID(),
        now: () => new Date(),
      });
      const started = await session.start({
        kind: "resume",
        roomId,
        expectedRole: role,
      });
      if (signal.aborted) {
        await session.dispose();
        return;
      }
      if (!started.ok || !store) {
        await session.dispose();
        setLobby({
          phase: "error",
          message: started.ok ? "Room state could not be verified." : started.message,
        });
        return;
      }
      const nextRuntime: MeetingRuntime = {
        client,
        session,
        store,
        snapshot: session.getSnapshot(),
      };
      setRuntime(nextRuntime);
      window.history.replaceState(null, "", `/meet?room=${roomId}`);
      roomUnsubscribeRef.current?.();
      roomUnsubscribeRef.current = session.subscribe(() =>
        setRuntime((current) =>
          current?.session === session
            ? { ...current, snapshot: session.getSnapshot() }
            : current,
        ),
      );
      const credentialApi = createBrowserOpenAiCredentialApi({ accessToken });
      openAiCredentialApiRef.current = credentialApi;
      setSavedOpenAiCredentialBusy(true);
      setSavedOpenAiCredentialError(null);
      void credentialApi.load(signal).then((result) => {
        if (
          signal.aborted ||
          openAiCredentialApiRef.current !== credentialApi
        )
          return;
        setSavedOpenAiCredentialBusy(false);
        if (!result.ok) {
          setSavedOpenAiCredential({ configured: false });
          selectSavedOpenAiCredential(false);
          setSavedOpenAiCredentialError(result.error.message);
          return;
        }
        setSavedOpenAiCredential(result.value);
        selectSavedOpenAiCredential(result.value.configured);
      });
  }

  async function saveOpenAiCredential(apiKey: string) {
    const signal = lifecycleAbortRef.current?.signal;
    const accessToken = runtime?.session.getAccessToken();
    if (!accessToken || !signal || signal.aborted) {
      setSavedOpenAiCredentialError(
        "OpenAI credential service is unavailable for this room.",
      );
      return;
    }
    const credentialApi = createBrowserOpenAiCredentialApi({ accessToken });
    openAiCredentialApiRef.current = credentialApi;
    setSavedOpenAiCredentialBusy(true);
    setSavedOpenAiCredentialError(null);
    const result = await credentialApi.save(
      { apiKey, confirmSave: true },
      signal,
    );
    if (
      signal.aborted ||
      openAiCredentialApiRef.current !== credentialApi
    )
      return;
    setSavedOpenAiCredentialBusy(false);
    if (!result.ok) {
      setSavedOpenAiCredentialError(result.error.message);
      return;
    }
    openAiApiKeyRef.current = "";
    setOpenAiApiKey("");
    setSavedOpenAiCredential(result.value);
    selectSavedOpenAiCredential(true);
  }

  async function deleteOpenAiCredential() {
    const signal = lifecycleAbortRef.current?.signal;
    const accessToken = runtime?.session.getAccessToken();
    if (!accessToken || !signal || signal.aborted) {
      setSavedOpenAiCredentialError(
        "OpenAI credential service is unavailable for this room.",
      );
      return;
    }
    const credentialApi = createBrowserOpenAiCredentialApi({ accessToken });
    openAiCredentialApiRef.current = credentialApi;
    setSavedOpenAiCredentialBusy(true);
    setSavedOpenAiCredentialError(null);
    const result = await credentialApi.clear(signal);
    if (
      signal.aborted ||
      openAiCredentialApiRef.current !== credentialApi
    )
      return;
    setSavedOpenAiCredentialBusy(false);
    if (!result.ok) {
      setSavedOpenAiCredentialError(result.error.message);
      return;
    }
    setSavedOpenAiCredential(result.value);
    selectSavedOpenAiCredential(false);
  }

  async function requestCode(form: FormData) {
    const client = clientRef.current;
    if (!client || lobby.phase !== "email") return;
    const email = String(form.get("email") ?? "");
    setLobby({ phase: "working", message: "Sending a six-digit code…" });
    const current = await client.auth.getSession();
    if (current.data.session?.user?.is_anonymous === true)
      await client.auth.signOut({ scope: "local" });
    const result = await requestEmailOtp(client, email);
    if (!result.ok) {
      setLobby({ phase: "email", invited: lobby.invited, error: result.message });
      return;
    }
    setLobby({ phase: "otp", invited: lobby.invited, email: result.email });
  }

  async function switchInvitationAccount() {
    const client = clientRef.current;
    const invitation = inviteTokenRef.current;
    if (!client || !invitation || lobby.phase !== "invite_account") return;
    const previous = lobby;
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted) return;
    setLobby({ phase: "working", message: "Switching accounts…" });
    try {
      const result = await client.auth.signOut({ scope: "local" });
      if (signal.aborted) return;
      if (result.error) {
        setLobby({
          ...previous,
          error: "This account could not be signed out. Try again.",
        });
        return;
      }
      clearAccountScopedCredentialState();
      setLobby({ phase: "email", invited: true });
    } catch {
      if (!signal.aborted)
        setLobby({
          ...previous,
          error: "This account could not be signed out. Try again.",
        });
    }
  }

  async function verifyCode(form: FormData) {
    const client = clientRef.current;
    if (!client || lobby.phase !== "otp") return;
    const code = String(form.get("code") ?? "");
    const previous = lobby;
    setLobby({ phase: "working", message: "Verifying your code…" });
    const result = await verifyEmailOtp(client, previous.email, code);
    if (!result.ok) {
      setLobby({ ...previous, error: result.message });
      return;
    }
    const inviteToken = inviteTokenRef.current;
    if (inviteToken) {
      const signal = lifecycleAbortRef.current?.signal;
      if (!signal || signal.aborted) return;
      await acceptAndEnter(
        client,
        result.value.session.access_token,
        inviteToken,
        signal,
        result.value.email,
      );
      return;
    }
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted) return;
    await showHostForm(
      result.value.session.access_token,
      result.value.email,
      signal,
    );
  }

  async function createMeeting(form: FormData) {
    const client = clientRef.current;
    if (!client || lobby.phase !== "host_form") return;
    const previousEmail = lobby.email;
    const draft = {
      roomName: String(form.get("roomName") ?? ""),
      displayName: String(form.get("displayName") ?? ""),
      color: lobby.color ?? "#0ea5e9",
    };
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted) return;
    setLobby({ phase: "working", message: "Creating the shared workspace…" });
    const recovered = await recoverBrowserSession(client, {
      refreshAfterThrown: false,
    });
    if (signal.aborted) return;
    const accessToken = recovered.ok
      ? recovered.session?.access_token
      : undefined;
    if (!accessToken) {
      setLobby({
        phase: "host_form",
        email: previousEmail,
        ...draft,
        error: "Your session could not be refreshed. Try again.",
      });
      return;
    }
    try {
      const api = createBrowserMeetingApi({ accessToken });
      const result = await api.createMeeting(
        {
          name: draft.roomName,
          displayName: draft.displayName,
          color: draft.color,
        },
        signal,
      );
      if (signal.aborted) return;
      if (!result.ok) {
        setLobby({
          phase: "host_form",
          email: previousEmail,
          ...draft,
          error: result.error.message,
        });
        return;
      }
      await enterRoom(client, accessToken, result.value.roomId, "host", signal);
    } catch {
      if (!signal.aborted)
        setLobby({
          phase: "host_form",
          email: previousEmail,
          ...draft,
          error: "Room creation could not be confirmed. Try again to recover it.",
        });
    }
  }

  async function createInvitation(form: FormData) {
    if (!runtime || runtime.snapshot.membership?.role !== "host") return;
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted) return;
    setInviteBusy(true);
    setInviteResult(null);
    setInviteError(null);
    let current: Awaited<ReturnType<typeof runtime.client.auth.getSession>>;
    try {
      current = await runtime.client.auth.getSession();
    } catch {
      if (signal.aborted) return;
      setInviteBusy(false);
      setInviteError("Your session could not be refreshed. Try again.");
      return;
    }
    if (signal.aborted) return;
    const accessToken = current.data.session?.access_token;
    if (current.error) {
      setInviteBusy(false);
      setInviteError("Your session could not be refreshed. Try again.");
      return;
    }
    if (!accessToken) {
      setInviteBusy(false);
      setInviteError("Your verified session expired.");
      return;
    }
    const api = createBrowserMeetingApi({ accessToken });
    const result = await api.createInvitation(runtime.snapshot.roomId!, {
      email: String(form.get("email") ?? ""),
      displayName: String(form.get("displayName") ?? ""),
      color: "#a855f7",
      expiresInHours: 24,
    }, signal);
    if (signal.aborted) return;
    setInviteBusy(false);
    if (!result.ok) {
      setInviteError(result.error.message);
      return;
    }
    setInviteResult(result.value);
    setCopyLabel("Copy secure link");
    if (
      ["created", "sending", "reconciling", "submitted"].includes(
        result.value.delivery.status,
      )
    ) {
      invitationPollAbortRef.current?.abort();
      const pollController = new AbortController();
      invitationPollAbortRef.current = pollController;
      const abortPoll = () => pollController.abort();
      signal.addEventListener("abort", abortPoll, { once: true });
      void pollInvitationDelivery({
        api,
        roomId: result.value.roomId,
        invitationId: result.value.invitationId,
        signal: pollController.signal,
        onUpdate: (delivery) => {
          if (pollController.signal.aborted) return;
          setInviteResult((currentResult) =>
            currentResult?.invitationId === delivery.invitationId
              ? { ...currentResult, delivery: delivery.delivery }
              : currentResult,
          );
        },
      }).finally(() => {
        signal.removeEventListener("abort", abortPoll);
        if (invitationPollAbortRef.current === pollController)
          invitationPollAbortRef.current = null;
      });
    }
  }

  const runtimeStore = runtime?.store ?? null;
  const runtimeSession = runtime?.session ?? null;
  const packetWorkflow = useMeetingPacketWorkflow({
    session: runtimeSession,
    store: runtimeStore,
    canManage: runtime?.snapshot.membership?.role === "host",
  });
  const packetGetStatus = packetWorkflow.getStatus;
  const prepareMeetingPacket = packetWorkflow.preparePacket;
  const stageMeetingPacketSend = packetWorkflow.stagePacketSend;

  useEffect(() => {
    if (!runtimeSession) return;
    const disposedSessions = disposedRuntimeSessionsRef.current;
    activeRuntimeSessionRef.current = runtimeSession;
    return () => {
      if (activeRuntimeSessionRef.current === runtimeSession)
        activeRuntimeSessionRef.current = null;
      // React StrictMode immediately replays effects in development. Defer one
      // microtask so a replay can re-claim the same live session; replacement
      // or actual navigation still disposes it exactly once.
      queueMicrotask(() => {
        if (
          activeRuntimeSessionRef.current !== runtimeSession &&
          !disposedSessions.has(runtimeSession)
        ) {
          disposedSessions.add(runtimeSession);
          void runtimeSession.dispose();
        }
      });
    };
  }, [runtimeSession]);

  const sketchTransformer = useMemo(
    () =>
      runtimeStore && runtimeSession
        ? createCanvasSketchTransformer({
            store: runtimeStore,
            session: runtimeSession,
          })
        : null,
    [runtimeSession, runtimeStore],
  );

  useEffect(() => {
    if (!runtimeStore || !runtimeSession || !sketchTransformer) return;
    if (!webMcpTarget) {
      void Promise.resolve().then(() =>
        setWebMcpStatus({ value: "Site Tools unavailable", tone: "idle" }),
      );
      void Promise.resolve().then(() =>
        setWebMcpSurfaceState({ status: "unavailable" }),
      );
      return;
    }
    const registry = createStandardMeetingWebMcpRegistry({
      mode:
        process.env.NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION === "true"
          ? "dynamic"
          : "static",
      target: webMcpTarget,
      store: runtimeStore,
      session: runtimeSession,
      getSnapshot: runtimeSession.getSnapshot,
      transformSketch: sketchTransformer.transform,
      packetWorkflow: {
        getStatus: packetGetStatus,
        preparePacket: prepareMeetingPacket,
        stagePacketSend: stageMeetingPacketSend,
      },
      onExecutionEvent(event) {
        if (!active) return;
        setWebMcpExecutionActivity((current) =>
          upsertWebMcpExecutionActivity(current, event),
        );
        setWebMcpSurfaceState({
          status: "invoked",
          registeredToolCount: registry.registeredToolNames().length,
          latestInvocationId: event.invocationId,
        });
      },
    });
    webMcpRegistryRef.current = registry;
    let active = true;
    const sync = async () => {
      try {
        await registry.sync();
        if (active)
          setWebMcpStatus({
            value: `${registry.registeredToolNames().length} Site Tools registered`,
            tone: "ready",
          });
        if (active)
          setWebMcpSurfaceState((current) =>
            current.status === "invoked"
              ? current
              : {
                  status: "registered_to_page",
                  registeredToolCount: registry.registeredToolNames().length,
                },
          );
      } catch {
        if (active)
          setWebMcpStatus({ value: "Site Tools registration failed", tone: "idle" });
        if (active)
          setWebMcpSurfaceState({ status: "registration_failed" });
      }
    };
    void sync();
    const unsubscribers =
      process.env.NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION === "true"
        ? [runtimeStore.subscribe(() => void sync()), runtimeSession.subscribe(() => void sync())]
        : [];
    return () => {
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
      registry.dispose();
      if (webMcpRegistryRef.current === registry)
        webMcpRegistryRef.current = null;
    };
  }, [
    packetGetStatus,
    prepareMeetingPacket,
    runtimeSession,
    runtimeStore,
    sketchTransformer,
    stageMeetingPacketSend,
    webMcpTarget,
  ]);

  useEffect(() => {
    const registry = webMcpRegistryRef.current;
    if (!registry) return;
    void registry.sync().then(
      () =>
        {
          setWebMcpStatus({
            value: `${registry.registeredToolNames().length} Site Tools registered`,
            tone: "ready",
          });
          setWebMcpSurfaceState((current) =>
            current.status === "invoked"
              ? current
              : {
                  status: "registered_to_page",
                  registeredToolCount: registry.registeredToolNames().length,
                },
          );
        },
      () => {
        setWebMcpStatus({
          value: "Site Tools registration failed",
          tone: "idle",
        });
        setWebMcpSurfaceState({ status: "registration_failed" });
      },
    );
  }, [packetWorkflow.state.packet?.status]);
  const createHandController = useCallback(
    (preferences: SpatialCameraControllerPreferences) =>
      createSharedCameraHandController(
        meetingHandControllerOptions({
          enabled: privateGpuRelayEnabled,
          roomId: runtime?.snapshot.roomId ?? null,
          getAccessToken: runtime?.session.getAccessToken ?? (() => null),
          cameraUploadConsent: preferences.cameraUploadConsent,
          getMeetingStream: () => meetingMediaStreamRef.current,
        }),
      ),
    [privateGpuRelayEnabled, runtime],
  );

  if (!runtime) return <MeetingLobby state={lobby} onRequestCode={requestCode} onVerifyCode={verifyCode} onSwitchInvitationAccount={switchInvitationAccount} onCreateMeeting={createMeeting} />;

  const { snapshot } = runtime;
  const participants = snapshot.presence.map((participant) => ({
    id: participant.participantId,
    displayName: participant.displayName,
    color: participant.color,
    role: participant.role,
  }));
  const participantById = new Map(
    snapshot.presence.map((participant) => [participant.participantId, participant]),
  );
  const remoteCursors = Object.values(snapshot.cursors).flatMap((cursor) => {
    if (cursor.participantId === snapshot.identity?.userId) return [];
    const participant = participantById.get(cursor.participantId);
    return participant
      ? [{
          participantId: cursor.participantId,
          displayName: participant.displayName,
          color: participant.color,
          x: cursor.x,
          y: cursor.y,
        }]
      : [];
  });
  const filmstripParticipants = [...participants];
  if (snapshot.membership && !filmstripParticipants.some((p) => p.id === snapshot.membership!.userId))
    filmstripParticipants.push({
      id: snapshot.membership.userId,
      displayName: snapshot.membership.displayName,
      color: snapshot.membership.color,
      role: snapshot.membership.role,
    });

  return (
    <div className="meeting-room-stage">
      <div className="meeting-room-float">
        <strong>{snapshot.membership?.role === "host" ? "HOST" : "PARTICIPANT"}</strong>
        {snapshot.membership?.role === "host" ? (
          <button
            type="button"
            onClick={() => {
              setInviteOpen(true);
              setInviteError(null);
            }}
          >
            Invite
          </button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            await runtime.client.auth.signOut({ scope: "local" });
            clearAccountScopedCredentialState();
            window.history.replaceState(null, "", "/meet");
            window.location.reload();
          }}
        >
          Leave
        </button>
      </div>
      <CommandCanvasRoom
        store={runtime.store}
        roomLabel="Live meeting room"
        roomStatus={snapshot.realtimeStatus === "connected" ? "live" : "connecting"}
        participants={participants}
        remoteCursors={remoteCursors}
        serviceStatus={{
          webMcp: webMcpStatus,
          collaboration: {
            value:
              snapshot.realtimeStatus === "connected"
                ? `${snapshot.presence.length} present`
                : "Connecting…",
            tone: snapshot.realtimeStatus === "connected" ? "ready" : "working",
          },
          spatialInput: { value: "Camera off · pointer active", tone: "idle" },
        }}
        webMcpSurfaceState={webMcpSurfaceState}
        webMcpExecutionActivity={webMcpExecutionActivity}
        onCommand={async (command, source) => {
          const result = await runtime.session.submitCommand(command, source);
          if (!result.ok) {
            if (result.commandCode)
              return {
                ok: false as const,
                state: runtime.store.getState().canvas,
                error: {
                  code: result.commandCode,
                  message: result.message,
                },
              };
            throw new Error(result.message);
          }
        }}
        onTransformSketch={sketchTransformer?.transform}
        onCanvasPointerWorldMove={(point: CanvasPoint) => {
          void runtime.session.publishCursor(point);
        }}
        createHandTrackingController={createHandController}
        privateGpuRelayAvailable={Boolean(
          privateGpuRelayEnabled && snapshot.roomId,
        )}
        realtimeVoice={{
          roomId: snapshot.roomId!,
          getAccessToken: runtime.session.getAccessToken,
          disabled: snapshot.status !== "ready" && snapshot.status !== "degraded",
          useSavedOpenAiCredential,
          onUseSavedOpenAiCredentialChange: selectSavedOpenAiCredential,
          savedOpenAiCredential: {
            ...savedOpenAiCredential,
            busy: savedOpenAiCredentialBusy,
            ...(savedOpenAiCredentialError
              ? { error: savedOpenAiCredentialError }
              : {}),
            onSave: saveOpenAiCredential,
            onDelete: deleteOpenAiCredential,
          },
        }}
        openAiApiKey={openAiApiKey}
        onOpenAiApiKeyChange={(value) => {
          openAiApiKeyRef.current = value;
          setOpenAiApiKey(value);
        }}
        meetingMediaPanel={
          snapshot.membership ? (
            <MeetingFilmstrip
              roomId={snapshot.roomId!}
              localParticipantId={snapshot.membership.userId}
              participants={filmstripParticipants}
              getAccessToken={runtime.session.getAccessToken}
              client={runtime.client as unknown as MeetingMediaClient}
              onLocalStreamChange={(stream) => {
                meetingMediaStreamRef.current = stream;
              }}
            />
          ) : undefined
        }
        commandDrawerRequestKey={packetWorkflow.state.stagedSend?.id}
        meetingPacketPanel={
          snapshot.membership?.role === "host" ? (
            <MeetingPacketWorkflowPanel workflow={packetWorkflow} />
          ) : undefined
        }
      />
      {inviteOpen ? (
        <div className="meeting-overlay" role="dialog" aria-modal="true" aria-label="Invite participant">
          <section className="meeting-card meeting-invite-card">
            <button className="meeting-close" type="button" aria-label="Close invite" onClick={() => setInviteOpen(false)}>×</button>
            <p className="eyebrow">Email-bound invitation</p>
            <h2>Bring someone into the room</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createInvitation(new FormData(event.currentTarget));
              }}
            >
              <label>Display name<input name="displayName" required maxLength={64} autoComplete="name" /></label>
              <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
              <button type="submit" disabled={inviteBusy}>{inviteBusy ? "Sending…" : "Send invitation"}</button>
            </form>
            {inviteError ? (
              <div
                className="meeting-delivery meeting-delivery-failed"
                role="alert"
              >
                <strong>Invitation not created</strong>
                <p>{inviteError}</p>
              </div>
            ) : null}
            {inviteResult ? (
              <div className={`meeting-delivery meeting-delivery-${inviteResult.delivery.status}`} aria-live="polite">
                <strong>
                  {INVITATION_DELIVERY_LABELS[inviteResult.delivery.status]}
                </strong>
                <p>{inviteResult.delivery.message}</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteResult.joinUrl);
                      setCopyLabel("Secure link copied");
                    } catch {
                      setCopyLabel("Clipboard unavailable");
                    }
                  }}
                >{copyLabel}</button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function meetingHandControllerOptions(input: {
  enabled: boolean;
  roomId: string | null;
  getAccessToken: () => string | null;
  cameraUploadConsent: () => boolean;
  getMeetingStream: () => MediaStream | null;
}) {
  return {
    getMeetingStream: input.getMeetingStream,
    ...(input.enabled && input.roomId
      ? {
          privateHandRelay: {
            roomId: input.roomId,
            getAccessToken: input.getAccessToken,
            cameraUploadConsent: input.cameraUploadConsent,
          },
        }
      : {}),
  };
}

export function readMeetingInviteOnce(
  memory: {
    read: { current: boolean };
    token: { current: string | null };
  },
  location: Parameters<typeof readAndScrubMeetingInvite>[0],
) {
  if (memory.read.current) return memory.token.current;
  memory.read.current = true;
  memory.token.current = readAndScrubMeetingInvite(location);
  return memory.token.current;
}

export function createMeetingSessionCleanup(
  session: Pick<DemoRoomSession, "dispose">,
) {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    void session.dispose();
  };
}

export function createStandardMeetingWebMcpRegistry(options: {
  mode: "static" | "dynamic";
  target: WebMcpRegistrationTarget;
  store: StoreApi<CanvasStoreState>;
  session: Pick<DemoRoomSession, "submitCommand">;
  getSnapshot: () => DemoRoomSnapshot;
  transformSketch: ReturnType<typeof createCanvasSketchTransformer>["transform"];
  packetWorkflow?: Pick<
    MeetingPacketWorkflowController,
    "getStatus" | "preparePacket" | "stagePacketSend"
  >;
  onExecutionEvent?: (event: WebMcpExecutionEvent) => void;
}) {
  return new WebMcpRegistry({
    mode: options.mode,
    target: options.target,
    getContext: () =>
      standardMeetingWebMcpContext(
        options.store,
        options.getSnapshot(),
        options.packetWorkflow?.getStatus() ?? "none",
      ),
    adapters: createCanvasWebMcpAdapters({
      store: options.store,
      transformSketch: options.transformSketch,
      prepareMeetingPacket: options.packetWorkflow
        ? async (request) => {
            const result = await options.packetWorkflow!.preparePacket(
              {
                title: request.input.title,
                objectIds: request.input.objectIds,
                actorType: "agent",
              },
              request.signal,
            );
            if (!result.ok) return webMcpPacketFailure(result.error);
            return {
              ok: true,
              status: "completed",
              message: "Meeting packet draft prepared for host review.",
              data: {
                packetId: result.value.packetId,
                packetVersion: result.value.packetVersion,
                sourceRevision: result.value.sourceRevision,
                objectCount: result.value.objectCount,
              },
            };
          }
        : undefined,
      stagePacketSendRequest: options.packetWorkflow
        ? async (request) => {
            const result = await options.packetWorkflow!.stagePacketSend(
              request.input.packetId,
              "agent",
              request.signal,
            );
            if (!result.ok) return webMcpPacketFailure(result.error);
            return {
              ok: true,
              status: "awaiting_human_approval",
              message:
                "Packet send staged. The host must review the exact recipients and press SEND.",
              data: {
                packetId: result.value.packetId,
                sendRequestId: result.value.sendRequestId,
                recipientCount: result.value.recipientCount,
              },
            };
          }
        : undefined,
      dispatchMutation: async (command, signal) => {
        const result = await options.session.submitCommand(command, "webmcp", signal);
        if (!result.ok)
          return {
            ok: false,
            code: result.code === "host_required" ? "forbidden" : "execution_failed",
            message: result.message,
          };
        const receipt = result.state.receipts.at(-1);
        if (!receipt || receipt.source !== "webmcp")
          return {
            ok: false,
            code: "execution_failed",
            message: "Agent mutation receipt could not be verified.",
          };
        return {
          ok: true,
          status: "completed",
          message: receipt.description,
          receiptId: receipt.id,
          data: {
            revision: receipt.revision,
            affectedObjectIds: receipt.affectedObjectIds,
          },
        };
      },
    }),
    onExecutionEvent: options.onExecutionEvent,
  });
}

function standardMeetingWebMcpContext(
  store: StoreApi<CanvasStoreState>,
  snapshot: DemoRoomSnapshot,
  packetStatus: "none" | "draft" | "approved",
): WebMcpExecutionContext {
  const state = store.getState();
  const objects = Object.values(state.canvas.objects).filter(
    (object) => !object.deletedAt,
  );
  const selected = state.selectedObjectId
    ? state.canvas.objects[state.selectedObjectId]
    : undefined;
  return {
    phase: {
      roomActive: Boolean(snapshot.roomId && snapshot.membership),
      hasContent: objects.length > 0,
      selection: selected
        ? selected.type === "sketch"
          ? "sketch"
          : "object"
        : "none",
      collaboratorCount: snapshot.presence.length,
      packet:
        packetStatus === "approved"
          ? "approved"
          : packetStatus === "draft"
            ? "prepared"
            : "none",
    },
    actor: snapshot.membership
      ? {
          participantId: snapshot.membership.userId,
          role: snapshot.membership.role,
        }
      : null,
    canMutateCanvas: Boolean(snapshot.membership),
  };
}

export function MeetingLobby({
  state,
  onRequestCode,
  onVerifyCode,
  onSwitchInvitationAccount,
  onCreateMeeting,
}: {
  state: MeetingLobbyState;
  onRequestCode: (form: FormData) => void | Promise<void>;
  onVerifyCode: (form: FormData) => void | Promise<void>;
  onSwitchInvitationAccount: () => void | Promise<void>;
  onCreateMeeting: (form: FormData) => void | Promise<void>;
}) {
  return (
    <main className="meeting-lobby">
      <div className="meeting-lobby-canvas" aria-hidden="true" />
      <section className="meeting-card" aria-live="polite">
        <span className="demo-gate-mark" aria-hidden="true">CC</span>
        {state.phase === "initializing" || state.phase === "working" ? (
          <><p className="eyebrow">CommandCanvas / meeting</p><h1>{state.phase === "working" ? state.message : "Opening the room…"}</h1></>
        ) : state.phase === "invite_account" ? (
          <>
            <p className="eyebrow">Private room invitation</p>
            <h1>Switch to the invited account</h1>
            <p>
              {`You’re signed in as ${state.email}. This invitation could not be accepted as that account. If your host invited another email address, switch accounts and verify that exact email.`}
            </p>
            <p role="alert">{state.message}</p>
            <button type="button" onClick={onSwitchInvitationAccount}>
              Switch account and continue
            </button>
            {state.error ? <p role="alert">{state.error}</p> : null}
            <a href="/meet">Cancel and return to meeting lobby</a>
          </>
        ) : state.phase === "error" ? (
          <><p className="eyebrow">Meeting unavailable</p><h1>We couldn’t open this room.</h1><p role="alert">{state.message}</p><a href="/meet">Return to meeting lobby</a></>
        ) : state.phase === "email" ? (
          <>
            <p className="eyebrow">{state.invited ? "Private room invitation" : "Your CommandCanvas account"}</p>
            <h1>{state.invited ? "Verify your invitation" : "Sign in to your CommandCanvas workspace"}</h1>
            <p>
              {state.invited
                ? "Use the exact email address your host invited."
                : "A six-digit email code protects your rooms, invitations, and saved OpenAI key. No password is required."}
            </p>
            {!state.invited ? (
              <p className="meeting-chatgpt-boundary">
                In the ChatGPT desktop app&apos;s built-in browser, Site Tools use
                the ChatGPT account already signed into that app. CommandCanvas
                sign-in is separate and protects this workspace. That built-in
                browser keeps its own website session apart from Chrome, so this
                room may still require an email code here.
              </p>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onRequestCode(new FormData(event.currentTarget));
              }}
            >
              <label>Email<input name="email" type="email" required autoComplete="email" maxLength={254} autoFocus /></label>
              <button type="submit">Email me a code</button>
            </form>
            {state.error ? <p role="alert">{state.error}</p> : null}
            {!state.invited ? <a className="meeting-demo-link" href="/demo">Open the no-signup judge preview instead</a> : null}
          </>
        ) : state.phase === "otp" ? (
          <>
            <p className="eyebrow">Code sent to {state.email}</p>
            <h1>Enter your six-digit code</h1>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onVerifyCode(new FormData(event.currentTarget));
              }}
            >
              <label>Verification code<input name="code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" required autoFocus /></label>
              <button type="submit">Verify email</button>
            </form>
            {state.error ? <p role="alert">{state.error}</p> : null}
          </>
        ) : (
          <>
            <p className="eyebrow">Verified as {state.email}</p>
            <h1>Create a shared spatial room</h1>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateMeeting(new FormData(event.currentTarget));
              }}
            >
              <label>Room name<input name="roomName" required maxLength={120} defaultValue={state.roomName ?? "Project working session"} /></label>
              <label>Your display name<input name="displayName" required maxLength={64} autoComplete="name" defaultValue={state.displayName ?? ""} /></label>
              <button type="submit">Enter CommandCanvas</button>
            </form>
            {state.error ? <p role="alert">{state.error}</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
