export const VISION_LAB_CONSENT_VERSION = "vision-lab-consent-v1";
export const VISION_LAB_PROTOCOL = {
  id: "commandcanvas-hand-finetune",
  version: 1,
} as const;

export const VISION_LAB_CAPTURE_TYPES = [
  { value: "acquisition", label: "Acquisition", guidance: "Frame one or two hands from wrist through fingertips. Slowly enter, leave, and reacquire the frame for 10 repetitions. Avoid cropped fingertips and overlays." },
  { value: "drawing", label: "Drawing", guidance: "Frame the active hand and clear workspace. Draw continuous lines, circles, and short strokes for 30 seconds. Avoid UI, pointer, or skeleton overlays." },
  { value: "pinch", label: "Pinch", guidance: "Keep thumb and index fingertip visible. Open and close a deliberate pinch 20 times at varied depths. Avoid hiding either fingertip." },
  { value: "edges-corners", label: "Edges and corners", guidance: "Frame the full hand while reaching each edge and corner. Hold each target for two seconds across 12 reaches. Avoid leaving the wrist outside frame." },
  { value: "two-hand-transforms", label: "Two-hand transforms", guidance: "Frame both wrists and all fingertips. Perform spread, rotate, and scale motions for 10 repetitions. Avoid hands occluding each other for the full take." },
  { value: "throws", label: "Throws", guidance: "Frame the throwing hand with room for travel. Perform 10 controlled release motions at slow and normal speed. Avoid real objects and unsafe fast throws." },
  { value: "difficult-conditions", label: "Difficult conditions", guidance: "Frame the hand under backlight, side light, motion, and partial occlusion. Repeat each condition for 10 seconds. Avoid filters or synthetic effects." },
  { value: "negative-no-hand", label: "Negative / no-hand", guidance: "Frame the ordinary workspace with no hands visible. Record 30 seconds with natural background movement. Avoid people, screens, documents, and overlays." },
] as const;

export type VisionLabCaptureType =
  (typeof VISION_LAB_CAPTURE_TYPES)[number]["value"];

export interface VisionLabUser {
  id: string;
  email?: string;
  emailConfirmedAt?: string;
  isAnonymous?: boolean;
}

export interface VisionLabMediaSettings {
  mimeType: string;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
}

export interface VisionLabManifest {
  schemaVersion: 1;
  sessionId: string;
  captureType: VisionLabCaptureType;
  startedAt: string;
  stoppedAt: string;
  media: VisionLabMediaSettings;
  mirrorDisplay: boolean;
  consentVersion: typeof VISION_LAB_CONSENT_VERSION;
  protocol: typeof VISION_LAB_PROTOCOL;
  videoSha256?: string;
}

export function isPermanentVisionLabUser(user: VisionLabUser | null): boolean {
  return Boolean(
    user &&
      user.id.trim() &&
      user.isAnonymous !== true &&
      user.email?.trim().includes("@") &&
      user.emailConfirmedAt?.trim(),
  );
}

export function createVisionLabManifest(
  input: Omit<VisionLabManifest, "schemaVersion" | "consentVersion" | "protocol">,
): VisionLabManifest {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    captureType: input.captureType,
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt,
    media: input.media,
    mirrorDisplay: input.mirrorDisplay,
    consentVersion: VISION_LAB_CONSENT_VERSION,
    protocol: VISION_LAB_PROTOCOL,
    ...(input.videoSha256 ? { videoSha256: input.videoSha256 } : {}),
  };
}

const WEBM_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function selectSupportedWebmMime(
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  return WEBM_MIME_CANDIDATES.find(isTypeSupported) ?? null;
}

export function mediaSettingsFromTrack(
  track: Pick<MediaStreamTrack, "getSettings"> | undefined,
  mimeType: string,
): VisionLabMediaSettings {
  const settings = track?.getSettings();
  return {
    mimeType,
    ...(typeof settings?.width === "number" ? { width: settings.width } : {}),
    ...(typeof settings?.height === "number" ? { height: settings.height } : {}),
    ...(typeof settings?.frameRate === "number"
      ? { frameRate: settings.frameRate }
      : {}),
    ...(typeof settings?.facingMode === "string"
      ? { facingMode: settings.facingMode }
      : {}),
  };
}

export function stopVisionLabTracks(stream: {
  getTracks: () => readonly { stop: () => void }[];
}): void {
  stream.getTracks().forEach((track) => track.stop());
}
