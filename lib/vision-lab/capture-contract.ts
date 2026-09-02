export const VISION_LAB_CONSENT_VERSION = "vision-lab-consent-v1";

export const VISION_LAB_CAPTURE_TYPES = [
  { value: "acquisition", label: "Acquisition" },
  { value: "drawing", label: "Drawing" },
  { value: "pinch", label: "Pinch" },
  { value: "edges-corners", label: "Edges and corners" },
  { value: "two-hand-transforms", label: "Two-hand transforms" },
  { value: "throws", label: "Throws" },
  { value: "difficult-conditions", label: "Difficult conditions" },
  { value: "negative-no-hand", label: "Negative / no-hand" },
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

export function createVisionLabManifest(input: Omit<VisionLabManifest, "schemaVersion" | "consentVersion">): VisionLabManifest {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    captureType: input.captureType,
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt,
    media: input.media,
    mirrorDisplay: input.mirrorDisplay,
    consentVersion: VISION_LAB_CONSENT_VERSION,
    ...(input.videoSha256 ? { videoSha256: input.videoSha256 } : {}),
  };
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
