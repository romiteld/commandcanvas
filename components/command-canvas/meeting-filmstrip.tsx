"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  createMeetingMediaController,
  type MeetingMediaClient,
  type MeetingMediaController,
  type MeetingMediaControllerOptions,
  type MeetingMediaSnapshot,
} from "@/lib/meeting/media-controller";
import { requestAuthoritativeMeetingRoster } from "@/lib/meeting/media-roster-browser";
import { requestMeetingIceServers } from "@/lib/meeting/turn-browser";

export interface MeetingFilmstripParticipant {
  id: string;
  displayName: string;
  color?: string;
}

export interface MeetingFilmstripProps {
  roomId: string;
  localParticipantId: string;
  participants: readonly MeetingFilmstripParticipant[];
  getAccessToken: () => string | null;
  client: MeetingMediaClient;
  acquireLocalMedia?: MeetingMediaControllerOptions["acquireLocalMedia"];
  loadAuthoritativeParticipantIds?: typeof requestAuthoritativeMeetingRoster;
  onLocalStreamChange?: (stream: MediaStream | null) => void;
  createController?: (
    options: MeetingMediaControllerOptions,
  ) => MeetingMediaController;
}

const EMPTY_MEDIA: MeetingMediaSnapshot = {
  state: "off",
  localStream: null,
  remoteStreams: {},
  peerStates: {},
  cameraEnabled: false,
  microphoneEnabled: false,
};
const EMPTY_PARTICIPANT_IDS: ReadonlySet<string> = new Set();
const AUTHORITATIVE_ROSTER_REFRESH_MS = 15_000;

interface AuthoritativeRosterSnapshot {
  identity: string;
  participantIds: ReadonlySet<string>;
  state: "eligible" | "over_capacity" | "unavailable";
}

export function MeetingFilmstrip({
  roomId,
  localParticipantId,
  participants,
  getAccessToken,
  client,
  acquireLocalMedia,
  loadAuthoritativeParticipantIds = requestAuthoritativeMeetingRoster,
  onLocalStreamChange,
  createController = createMeetingMediaController,
}: MeetingFilmstripProps) {
  const [expanded, setExpanded] = useState(false);
  const [media, setMedia] = useState<MeetingMediaSnapshot>(EMPTY_MEDIA);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoPanelId = useId();
  const controllerRef = useRef<MeetingMediaController | null>(null);
  const rosterIdentity = `${roomId}:${localParticipantId}`;
  const presenceRosterIdentity = useMemo(
    () => [...new Set(participants.map((participant) => participant.id))].sort().join(","),
    [participants],
  );
  const [rosterSnapshot, setRosterSnapshot] =
    useState<AuthoritativeRosterSnapshot | null>(null);
  const rosterState =
    rosterSnapshot?.identity === rosterIdentity
      ? rosterSnapshot.state
      : "loading";
  const allowedParticipantIds =
    rosterSnapshot?.identity === rosterIdentity
      ? rosterSnapshot.participantIds
      : EMPTY_PARTICIPANT_IDS;

  useEffect(() => {
    let active = true;
    const controller = createController({
      roomId,
      localParticipantId,
      allowedParticipantIds: new Set(),
      getAccessToken,
      ...(acquireLocalMedia ? { acquireLocalMedia } : {}),
      getIceServerConfig: () =>
        requestMeetingIceServers({
          roomId,
          accessToken: getAccessToken(),
        }),
      client,
      onSnapshot: (snapshot) => {
        if (active) setMedia(snapshot);
      },
    });
    controllerRef.current = controller;
    return () => {
      active = false;
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.dispose();
    };
  }, [
    acquireLocalMedia,
    client,
    createController,
    getAccessToken,
    localParticipantId,
    roomId,
  ]);

  useEffect(() => {
    let active = true;
    let requestController: AbortController | null = null;
    const refreshRoster = () => {
      if (!active || requestController) return;
      const controller = new AbortController();
      requestController = controller;
      void loadAuthoritativeParticipantIds({
        roomId,
        accessToken: getAccessToken(),
        signal: controller.signal,
      })
        .then((roster) => {
          if (!active || controller.signal.aborted) return;
          if (
            roster.status !== "eligible" ||
            !roster.participantIds.has(localParticipantId)
          ) {
            setRosterSnapshot({
              identity: rosterIdentity,
              participantIds: EMPTY_PARTICIPANT_IDS,
              state:
                roster.status === "eligible" ? "unavailable" : roster.status,
            });
            return;
          }
          setRosterSnapshot({
            identity: rosterIdentity,
            participantIds: new Set(roster.participantIds),
            state: "eligible",
          });
        })
        .catch(() => {
          if (!active || controller.signal.aborted) return;
          setRosterSnapshot({
            identity: rosterIdentity,
            participantIds: EMPTY_PARTICIPANT_IDS,
            state: "unavailable",
          });
        })
        .finally(() => {
          if (requestController === controller) requestController = null;
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshRoster();
    };

    refreshRoster();
    const interval = window.setInterval(
      refreshRoster,
      AUTHORITATIVE_ROSTER_REFRESH_MS,
    );
    window.addEventListener("focus", refreshRoster);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshRoster);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      requestController?.abort();
    };
  }, [
    getAccessToken,
    loadAuthoritativeParticipantIds,
    localParticipantId,
    presenceRosterIdentity,
    rosterIdentity,
    roomId,
  ]);

  useEffect(() => {
    if (rosterState === "loading") return;
    if (rosterState === "over_capacity")
      controllerRef.current?.setAllowedParticipantIds(
        EMPTY_PARTICIPANT_IDS,
        { overCapacity: true },
      );
    else
      controllerRef.current?.setAllowedParticipantIds(allowedParticipantIds);
  }, [allowedParticipantIds, rosterState]);

  useEffect(() => {
    onLocalStreamChange?.(media.localStream);
    return () => onLocalStreamChange?.(null);
  }, [media.localStream, onLocalStreamChange]);

  const visibleParticipants = useMemo(() => {
    const unique = new Map(participants.map((participant) => [participant.id, participant]));
    if (!unique.has(localParticipantId))
      unique.set(localParticipantId, {
        id: localParticipantId,
        displayName: "You",
      });
    return [...unique.values()].sort((left, right) => {
      if (left.id === localParticipantId) return -1;
      if (right.id === localParticipantId) return 1;
      return left.displayName.localeCompare(right.displayName);
    });
  }, [localParticipantId, participants]);
  const mediaCapacityExceeded = rosterState === "over_capacity";
  const mediaRosterReady =
    rosterState === "eligible" && allowedParticipantIds.has(localParticipantId);

  return (
    <section
      className={`meeting-filmstrip${expanded ? " is-expanded" : " is-collapsed"}`}
      aria-label="Meeting presence"
      data-view={expanded ? "videos" : "compact"}
    >
      <div className="meeting-filmstrip-bar">
        <div className="meeting-filmstrip-title">
          <span className={`meeting-media-dot meeting-media-${media.state}`} aria-hidden="true" />
          <strong>Meeting</strong>
          <span>
            {media.state === "active"
              ? "Direct media"
              : media.state === "requesting_permission"
                ? "Waiting for permission"
                : media.state === "connecting"
                  ? "Connecting"
                  : media.state === "signaling_lost"
                    ? "Signaling lost"
                    : media.state === "error"
                      ? "Media unavailable"
                      : "Meeting media off"}
          </span>
        </div>

        {!expanded ? (
          <ul
            className="meeting-presence-roster"
            aria-label="People in this room"
          >
            {visibleParticipants.map((participant) => {
              const local = participant.id === localParticipantId;
              return (
                <li
                  key={participant.id}
                  className={`meeting-presence-person${local ? " is-local" : ""}`}
                  aria-label={`${participant.displayName}${local ? ", you" : ""}`}
                  title={`${participant.displayName}${local ? " (you)" : ""}`}
                >
                  <span
                    className="meeting-presence-avatar"
                    style={{ background: participant.color ?? "#74859a" }}
                    aria-hidden="true"
                  >
                    {initials(participant.displayName)}
                  </span>
                  <span className="meeting-presence-name" aria-hidden="true">
                    {participant.displayName}
                    {local ? <small>You</small> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <span
          className="meeting-participant-count"
          aria-label={`${visibleParticipants.length} ${
            visibleParticipants.length === 1 ? "person" : "people"
          } present`}
        >
          {visibleParticipants.length} present
        </span>

        <div className="meeting-filmstrip-actions">
          {!media.localStream ? (
            <button
              type="button"
              disabled={mediaCapacityExceeded || !mediaRosterReady}
              onClick={() => {
                void controllerRef.current?.start().then((started) => {
                  if (started) setExpanded(true);
                });
              }}
              aria-label="Start camera and microphone"
              title="Start camera and microphone"
            >
              <MeetingControlIcon kind="camera" />
              <span className="meeting-control-label">Start camera</span>
            </button>
          ) : null}
          {media.localStream ? (
            <>
              <button
                type="button"
                aria-pressed={media.cameraEnabled}
                aria-label={
                  media.cameraEnabled ? "Stop sharing video" : "Share video"
                }
                title={
                  media.cameraEnabled ? "Stop sharing video" : "Share video"
                }
                onClick={() =>
                  controllerRef.current?.setCameraEnabled(!media.cameraEnabled)
                }
              >
                <MeetingControlIcon kind="camera" />
                <span className="meeting-control-label">
                  {media.cameraEnabled ? "Video shared" : "Video not shared"}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={!media.microphoneEnabled}
                aria-label={
                  media.microphoneEnabled
                    ? "Mute microphone"
                    : "Unmute microphone"
                }
                title={
                  media.microphoneEnabled
                    ? "Mute microphone"
                    : "Unmute microphone"
                }
                onClick={() =>
                  controllerRef.current?.setMicrophoneEnabled(
                    !media.microphoneEnabled,
                  )
                }
              >
                <MeetingControlIcon kind="microphone" />
                <span className="meeting-control-label">
                  {media.microphoneEnabled ? "Mic on" : "Muted"}
                </span>
              </button>
              <button
                type="button"
                className="meeting-leave-action"
                aria-label="Leave meeting video"
                title="Leave meeting video"
                onClick={() => void controllerRef.current?.stop()}
              >
                <MeetingControlIcon kind="leave" />
                <span className="meeting-control-label">Leave</span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="meeting-collapse-action"
            aria-controls={videoPanelId}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Hide participant videos" : "Show participant videos"
            }
            title={
              expanded ? "Hide participant videos" : "Show participant videos"
            }
            onClick={() => setExpanded((current) => !current)}
          >
            <MeetingControlIcon kind={expanded ? "hide" : "videos"} />
            <span className="meeting-control-label">
              {expanded ? "Hide" : "Videos"}
            </span>
          </button>
        </div>
      </div>

      <div
        id={videoPanelId}
        className="meeting-video-row"
        role="group"
        aria-label="Participant videos"
        hidden={!expanded}
      >
          {visibleParticipants.slice(0, 4).map((participant) => {
            const local = participant.id === localParticipantId;
            const remoteStream = local
              ? media.cameraEnabled
                ? media.localStream
                : undefined
              : media.remoteStreams[participant.id];
            const peerState = media.peerStates[participant.id];
            return (
              <article
                key={participant.id}
                className={`meeting-video-tile${remoteStream ? " has-video" : ""}`}
              >
                {remoteStream ? (
                  <MeetingVideo
                    stream={remoteStream}
                    muted={local}
                    participantName={participant.displayName}
                    label={`${participant.displayName}${local ? " self" : " live"} video`}
                    testId={local ? "local-meeting-video" : "remote-meeting-video"}
                    onPlaybackError={() =>
                      setPlaybackError(
                        local
                          ? "Your video could not play."
                          : `${participant.displayName}'s video could not play.`,
                      )
                    }
                    onPlaybackRecovered={() => setPlaybackError(null)}
                  />
                ) : (
                  <div
                    className="meeting-video-placeholder"
                    style={{
                      background: `${participant.color ?? "#74859a"}22`,
                    }}
                  >
                    <span
                      style={{ background: participant.color ?? "#74859a" }}
                      aria-hidden="true"
                    >
                      {initials(participant.displayName)}
                    </span>
                    <small>
                      {local
                        ? "Video not shared"
                        : media.state === "active" && peerState === "connecting"
                          ? "Connecting video"
                          : peerState === "failed"
                            ? "Direct connection failed"
                            : "Video off"}
                    </small>
                  </div>
                )}
                <footer>
                  <strong>
                    {participant.displayName}
                    {local ? " (you)" : ""}
                  </strong>
                  <span>
                    {local
                      ? media.microphoneEnabled
                        ? "Mic on"
                        : "Muted"
                      : remoteStream
                        ? "Direct connection"
                        : "Not sending video"}
                  </span>
                </footer>
              </article>
            );
          })}
          <p className="meeting-media-boundary">
            {mediaCapacityExceeded
              ? "This room has more than four verified members. Meeting media supports up to four."
              : "Small-room direct video · up to 4 people"}
          </p>
      </div>

      {media.localStream && !media.cameraEnabled ? (
        <p className="meeting-media-message" role="status">
          Video is not shared. Your camera may remain active locally for hand
          input.
        </p>
      ) : null}

      {mediaCapacityExceeded ? (
        <p className="meeting-media-message" role="status">
          This room has more than four verified members. Meeting media supports up to four.
        </p>
      ) : null}

      {!mediaCapacityExceeded && rosterState !== "eligible" ? (
        <p className="meeting-media-message" role="status">
          {rosterState === "loading"
            ? "Verifying meeting media access…"
            : "Verified meeting roster unavailable. Video remains off."}
        </p>
      ) : null}

      {media.message ? (
        <p className="meeting-media-message" role={media.state === "error" ? "alert" : "status"}>
          {media.message}
        </p>
      ) : null}
      {playbackError ? (
        <p className="meeting-media-message" role="alert">
          {playbackError}
        </p>
      ) : null}
    </section>
  );
}

function MeetingControlIcon({
  kind,
}: {
  kind: "camera" | "microphone" | "leave" | "videos" | "hide";
}) {
  return (
    <svg
      className="meeting-control-icon"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "camera" ? (
        <>
          <rect x="1.75" y="4.25" width="10.5" height="9.5" rx="2" />
          <path d="m12.25 7 4-2v8l-4-2" />
        </>
      ) : null}
      {kind === "microphone" ? (
        <>
          <rect x="6" y="2" width="6" height="9" rx="3" />
          <path d="M3.75 8.5a5.25 5.25 0 0 0 10.5 0M9 13.75V16M6.5 16h5" />
        </>
      ) : null}
      {kind === "leave" ? (
        <>
          <path d="M7.5 3H3v12h4.5M10.5 5.5 14 9l-3.5 3.5M6.5 9H14" />
        </>
      ) : null}
      {kind === "videos" ? (
        <>
          <rect x="2" y="3" width="6" height="5" rx="1" />
          <rect x="10" y="3" width="6" height="5" rx="1" />
          <rect x="2" y="10" width="6" height="5" rx="1" />
          <rect x="10" y="10" width="6" height="5" rx="1" />
        </>
      ) : null}
      {kind === "hide" ? <path d="m4 11 5-5 5 5" /> : null}
    </svg>
  );
}

function MeetingVideo({
  stream,
  muted,
  participantName,
  label,
  testId,
  onPlaybackError,
  onPlaybackRecovered,
}: {
  stream: MediaStream;
  muted: boolean;
  participantName: string;
  label: string;
  testId: string;
  onPlaybackError: () => void;
  onPlaybackRecovered: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPlaybackErrorRef = useRef(onPlaybackError);
  const onPlaybackRecoveredRef = useRef(onPlaybackRecovered);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    onPlaybackErrorRef.current = onPlaybackError;
  }, [onPlaybackError]);

  useEffect(() => {
    onPlaybackRecoveredRef.current = onPlaybackRecovered;
  }, [onPlaybackRecovered]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;

    if (!muted) {
      try {
        const playback = video.play();
        if (playback) {
          void playback.catch(() => {
            setPlaybackBlocked(true);
            onPlaybackErrorRef.current();
          });
        }
      } catch {
        void Promise.resolve().then(() => {
          setPlaybackBlocked(true);
          onPlaybackErrorRef.current();
        });
      }
    }

    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [muted, stream]);

  function resumePlayback() {
    const video = videoRef.current;
    if (!video) return;
    try {
      const playback = video.play();
      if (!playback) {
        setPlaybackBlocked(false);
        onPlaybackRecoveredRef.current();
        return;
      }
      void playback.then(
        () => {
          setPlaybackBlocked(false);
          onPlaybackRecoveredRef.current();
        },
        () => {
          setPlaybackBlocked(true);
          onPlaybackErrorRef.current();
        },
      );
    } catch {
      setPlaybackBlocked(true);
      onPlaybackErrorRef.current();
    }
  }

  return (
    <div className="meeting-video-surface">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        aria-label={label}
        data-testid={testId}
        onError={onPlaybackError}
      />
      {playbackBlocked ? (
        <button
          type="button"
          className="meeting-video-playback-action"
          aria-label={`Tap to play ${participantName}'s video`}
          onClick={resumePlayback}
        >
          Tap to play
        </button>
      ) : null}
    </div>
  );
}

function initials(value: string) {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?"
  );
}
