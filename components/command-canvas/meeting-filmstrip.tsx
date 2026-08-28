"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createMeetingMediaController,
  type MeetingMediaClient,
  type MeetingMediaController,
  type MeetingMediaControllerOptions,
  type MeetingMediaSnapshot,
} from "@/lib/meeting/media-controller";

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

export function MeetingFilmstrip({
  roomId,
  localParticipantId,
  participants,
  getAccessToken,
  client,
  onLocalStreamChange,
  createController = createMeetingMediaController,
}: MeetingFilmstripProps) {
  const [expanded, setExpanded] = useState(true);
  const [media, setMedia] = useState<MeetingMediaSnapshot>(EMPTY_MEDIA);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const controllerRef = useRef<MeetingMediaController | null>(null);
  const participantIds = useMemo(() => {
    const ids = new Set(participants.map(({ id }) => id));
    ids.add(localParticipantId);
    return ids;
  }, [localParticipantId, participants]);

  useEffect(() => {
    let active = true;
    const controller = createController({
      roomId,
      localParticipantId,
      allowedParticipantIds: new Set([localParticipantId]),
      getAccessToken,
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
  }, [client, createController, getAccessToken, localParticipantId, roomId]);

  useEffect(() => {
    controllerRef.current?.setAllowedParticipantIds(participantIds);
  }, [participantIds]);

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
  const mediaCapacityExceeded = visibleParticipants.length > 4;

  return (
    <section
      className={`meeting-filmstrip${expanded ? " is-expanded" : " is-collapsed"}`}
      aria-label="Meeting video"
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
                      : "Video off"}
          </span>
        </div>

        <div className="meeting-filmstrip-actions">
          {!media.localStream ? (
            <button
              type="button"
              disabled={mediaCapacityExceeded}
              onClick={() => void controllerRef.current?.start()}
              aria-label="Start camera and microphone"
            >
              Start camera + mic
            </button>
          ) : null}
          {media.localStream ? (
            <>
              <button
                type="button"
                aria-pressed={!media.cameraEnabled}
                aria-label={
                  media.cameraEnabled ? "Turn camera off" : "Turn camera on"
                }
                onClick={() =>
                  controllerRef.current?.setCameraEnabled(!media.cameraEnabled)
                }
              >
                {media.cameraEnabled ? "Camera on" : "Camera off"}
              </button>
              <button
                type="button"
                aria-pressed={!media.microphoneEnabled}
                aria-label={
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
                {media.microphoneEnabled ? "Mic on" : "Muted"}
              </button>
              <button
                type="button"
                className="meeting-leave-action"
                aria-label="Leave meeting video"
                onClick={() => void controllerRef.current?.stop()}
              >
                Leave
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="meeting-collapse-action"
            aria-expanded={expanded}
            aria-label={
              expanded ? "Collapse meeting video" : "Expand meeting video"
            }
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "⌃" : "⌄"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="meeting-video-row" aria-label="Meeting participants">
          {visibleParticipants.slice(0, 4).map((participant) => {
            const local = participant.id === localParticipantId;
            const remoteStream = local
              ? media.localStream
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
                        ? "Video off"
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
              ? `${visibleParticipants.length} people are present. Meeting media starts at four or fewer.`
              : "Small-room direct video · up to 4 people"}
          </p>
        </div>
      ) : null}

      {mediaCapacityExceeded ? (
        <p className="meeting-media-message" role="status">
          {visibleParticipants.length} people are present. Meeting media starts at
          four or fewer.
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
