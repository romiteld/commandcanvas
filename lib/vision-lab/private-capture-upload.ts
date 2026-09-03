import { Upload } from "tus-js-client";

import type {
  VisionLabCaptureType,
  VisionLabManifest,
  VisionLabUser,
} from "@/lib/vision-lab/capture-contract";
import { isPermanentVisionLabUser } from "@/lib/vision-lab/capture-contract";

export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

export interface VisionLabTusOptions {
  endpoint: string;
  retryDelays: number[];
  headers: Record<string, string>;
  uploadDataDuringCreation: boolean;
  removeFingerprintOnSuccess: boolean;
  chunkSize: number;
  metadata: Record<string, string>;
  fingerprint: (blob: Blob) => Promise<string>;
  onProgress: (bytesUploaded: number, bytesTotal: number) => void;
  onSuccess: () => void;
  onError: (error: Error) => void;
}

export interface VisionLabTusUpload {
  findPreviousUploads(): Promise<unknown[]>;
  resumeFromPreviousUpload(upload: unknown): void;
  start(): void;
  abort(shouldTerminate?: boolean): Promise<void>;
}

export interface PrivateCaptureSubmissionRow {
  actor_user_id: string;
  vision_lab_session_id: string;
  capture_type: VisionLabCaptureType;
  video_object_path: string;
  manifest_object_path: string;
  video_sha256: string;
  manifest_sha256: string;
  video_bytes: number;
  manifest_bytes: number;
  consent_version: string;
  protocol_id: string;
  protocol_version: number;
  status: "uploaded_unverified";
}

export interface PrivateCaptureUploadRuntime {
  supabaseUrl: string;
  publishableKey: string;
  getSession(): Promise<{
    accessToken: string;
    user: VisionLabUser;
  } | null>;
  sha256(blob: Blob): Promise<string>;
  insertSubmission(
    row: PrivateCaptureSubmissionRow,
    signal?: AbortSignal,
  ): Promise<{ id: string; status: string }>;
  removeObjects(
    objectPaths: readonly string[],
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<void>;
  createTusUpload(blob: Blob, options: VisionLabTusOptions): VisionLabTusUpload;
}

interface BrowserPrivateCaptureSession {
  access_token: string;
  user: {
    id: string;
    email?: string;
    email_confirmed_at?: string;
    is_anonymous?: boolean;
  };
}

interface BrowserPrivateCaptureRpcResult {
  data: unknown;
  error: { message?: string } | null;
}

interface BrowserPrivateCaptureRpcBuilder
  extends PromiseLike<BrowserPrivateCaptureRpcResult> {
  abortSignal(signal: AbortSignal): PromiseLike<BrowserPrivateCaptureRpcResult>;
}

interface BrowserPrivateCaptureClient {
  auth: {
    getSession(): Promise<{
      data: { session: BrowserPrivateCaptureSession | null };
      error: { message?: string } | null;
    }>;
  };
  rpc(
    name: string,
    parameters: Record<string, unknown>,
  ): BrowserPrivateCaptureRpcBuilder;
}

async function browserSha256(blob: Blob) {
  if (!globalThis.crypto?.subtle)
    throw new Error("Browser integrity hashing is unavailable.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function defaultTusUpload(blob: Blob, options: VisionLabTusOptions) {
  return new Upload(
    blob,
    options as ConstructorParameters<typeof Upload>[1],
  ) as unknown as VisionLabTusUpload;
}

export function createBrowserPrivateCaptureUploadRuntime(input: {
  supabaseUrl: string;
  publishableKey: string;
  client: BrowserPrivateCaptureClient;
  createTusUpload?: (
    blob: Blob,
    options: VisionLabTusOptions,
  ) => VisionLabTusUpload;
  sha256?: (blob: Blob) => Promise<string>;
  fetch?: (
    input: string,
    init?: RequestInit,
  ) => Promise<{ ok: boolean }>;
}): PrivateCaptureUploadRuntime {
  return {
    supabaseUrl: input.supabaseUrl,
    publishableKey: input.publishableKey,
    async getSession() {
      const { data, error } = await input.client.auth.getSession();
      if (error || !data.session) return null;
      return {
        accessToken: data.session.access_token,
        user: {
          id: data.session.user.id,
          email: data.session.user.email,
          emailConfirmedAt: data.session.user.email_confirmed_at,
          isAnonymous: data.session.user.is_anonymous,
        },
      };
    },
    sha256: input.sha256 ?? browserSha256,
    async insertSubmission(submission, signal) {
      const request = input.client.rpc(
        "finalize_vision_lab_capture_submission",
        {
          p_vision_lab_session_id: submission.vision_lab_session_id,
          p_capture_type: submission.capture_type,
          p_video_object_path: submission.video_object_path,
          p_manifest_object_path: submission.manifest_object_path,
          p_video_sha256: submission.video_sha256,
          p_manifest_sha256: submission.manifest_sha256,
          p_video_bytes: submission.video_bytes,
          p_manifest_bytes: submission.manifest_bytes,
          p_consent_version: submission.consent_version,
          p_protocol_id: submission.protocol_id,
          p_protocol_version: submission.protocol_version,
        },
      );
      const { data, error } = await (signal
        ? request.abortSignal(signal)
        : request);
      if (error || !data || typeof data !== "object")
        throw new Error("Vision Lab submission receipt was not confirmed.");
      const record = data as { id?: unknown; status?: unknown };
      if (typeof record.id !== "string" || typeof record.status !== "string")
        throw new Error("Vision Lab submission receipt was not confirmed.");
      return { id: record.id, status: record.status };
    },
    async removeObjects(objectPaths, accessToken, signal) {
      if (objectPaths.length === 0) return;
      const fetcher = input.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await fetcher(
        `${input.supabaseUrl}/storage/v1/object/vision-lab-captures`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${accessToken}`,
            apikey: input.publishableKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ prefixes: objectPaths }),
          ...(signal ? { signal } : {}),
        },
      );
      if (!response.ok)
        throw new Error("Vision Lab private cleanup was not confirmed.");
    },
    createTusUpload: input.createTusUpload ?? defaultTusUpload,
  };
}

export interface PrivateCaptureUploadInput {
  expectedActorId: string;
  sessionId: string;
  captureType: VisionLabCaptureType;
  video: Blob;
  manifest: VisionLabManifest;
}

export interface PrivateCaptureUploadProgress {
  file: "video" | "manifest";
  bytesUploaded: number;
  bytesTotal: number;
  overallBytesUploaded: number;
  overallBytesTotal: number;
  percentage: number;
}

type PrivateCaptureUploadErrorCode =
  | "configuration_invalid"
  | "permanent_owner_required"
  | "actor_mismatch"
  | "capture_invalid"
  | "manifest_mismatch"
  | "integrity_required"
  | "storage_upload_failed"
  | "cleanup_failed"
  | "receipt_failed";

export class PrivateCaptureUploadError extends Error {
  constructor(
    readonly code: PrivateCaptureUploadErrorCode,
    message: string,
    readonly pendingSubmission?: PrivateCaptureSubmissionRow,
  ) {
    super(message);
    this.name = "PrivateCaptureUploadError";
  }
}

export async function finalizePrivateCaptureSubmission(
  submission: PrivateCaptureSubmissionRow,
  runtime: PrivateCaptureUploadRuntime,
  signal?: AbortSignal,
): Promise<{
  submissionId: string;
  status: "uploaded_unverified";
}> {
  throwIfAborted(signal);
  let receipt: { id: string; status: string };
  try {
    receipt = await runtime.insertSubmission(submission, signal);
  } catch {
    throw new PrivateCaptureUploadError(
      "receipt_failed",
      "The files arrived but the private review receipt could not be confirmed. Retry the receipt or keep the local files.",
      submission,
    );
  }
  if (receipt.status !== "uploaded_unverified")
    throw new PrivateCaptureUploadError(
      "receipt_failed",
      "The files arrived but the private review receipt could not be confirmed. Retry the receipt or keep the local files.",
      submission,
    );
  return { submissionId: receipt.id, status: "uploaded_unverified" };
}

export function privateCaptureManifestBlob(manifest: VisionLabManifest): Blob {
  return new Blob([`${JSON.stringify(manifest, null, 2)}\n`], {
    type: "application/json",
  });
}

const SESSION_ID_PATTERN = /^vision-lab-[A-Za-z0-9_-]{8,120}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const TUS_RETRY_DELAYS = [0, 3_000, 5_000, 10_000, 20_000];

function abortError() {
  const error = new Error("Private capture transfer was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function directStorageEndpoint(supabaseUrl: string) {
  try {
    const url = new URL(supabaseUrl);
    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !match
    )
      throw new Error("invalid Supabase URL");
    return `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable`;
  } catch {
    throw new PrivateCaptureUploadError(
      "configuration_invalid",
      "Private capture transfer is not configured for this environment.",
    );
  }
}

async function uploadBlob(
  runtime: PrivateCaptureUploadRuntime,
  input: {
    blob: Blob;
    endpoint: string;
    accessToken: string;
    objectPath: string;
    contentType: "video/webm" | "application/json";
    fingerprint: string;
    signal?: AbortSignal;
    onProgress: (bytesUploaded: number, bytesTotal: number) => void;
  },
) {
  throwIfAborted(input.signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (result?: Error) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", handleAbort);
      if (result) reject(result);
      else resolve();
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", handleAbort);
      void upload.abort(true).then(
        () => reject(abortError()),
        () =>
          reject(
            new PrivateCaptureUploadError(
              "cleanup_failed",
              "The transfer stopped, but private cleanup could not be confirmed. The local recording is still available.",
            ),
          ),
      );
    };

    const upload = runtime.createTusUpload(input.blob, {
      endpoint: input.endpoint,
      retryDelays: [...TUS_RETRY_DELAYS],
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        apikey: runtime.publishableKey,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_BYTES,
      metadata: {
        bucketName: "vision-lab-captures",
        objectName: input.objectPath,
        contentType: input.contentType,
        cacheControl: "3600",
      },
      fingerprint: async () => input.fingerprint,
      onProgress: input.onProgress,
      onSuccess: () => finish(),
      onError: () => {
        if (settled) return;
        settled = true;
        input.signal?.removeEventListener("abort", handleAbort);
        void upload.abort(true).then(
          () =>
            reject(
              new PrivateCaptureUploadError(
                "storage_upload_failed",
                "The private capture transfer failed. The local recording is still available.",
              ),
            ),
          () =>
            reject(
              new PrivateCaptureUploadError(
                "cleanup_failed",
                "The transfer stopped, but private cleanup could not be confirmed. The local recording is still available.",
              ),
            ),
        );
      },
    });

    input.signal?.addEventListener("abort", handleAbort, { once: true });
    void upload.findPreviousUploads().then(
      (previousUploads) => {
        if (settled) return;
        if (input.signal?.aborted) {
          handleAbort();
          return;
        }
        if (previousUploads.length > 0)
          upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      },
      () =>
        finish(
          new PrivateCaptureUploadError(
            "storage_upload_failed",
            "The private capture transfer failed. The local recording is still available.",
          ),
        ),
    );
  });
}

export async function uploadPrivateVisionLabCapture(
  input: PrivateCaptureUploadInput,
  runtime: PrivateCaptureUploadRuntime,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: PrivateCaptureUploadProgress) => void;
  } = {},
): Promise<{
  submissionId: string;
  status: "uploaded_unverified";
  videoObjectPath: string;
  manifestObjectPath: string;
}> {
  throwIfAborted(options.signal);
  if (!runtime.publishableKey.trim())
    throw new PrivateCaptureUploadError(
      "configuration_invalid",
      "Private capture transfer is not configured for this environment.",
    );
  const endpoint = directStorageEndpoint(runtime.supabaseUrl);
  if (
    !SESSION_ID_PATTERN.test(input.sessionId) ||
    input.video.size <= 0 ||
    input.video.size > MAX_VIDEO_BYTES
  )
    throw new PrivateCaptureUploadError(
      "capture_invalid",
      "The completed capture is outside the private transfer limits.",
    );
  if (
    input.manifest.sessionId !== input.sessionId ||
    input.manifest.captureType !== input.captureType
  )
    throw new PrivateCaptureUploadError(
      "manifest_mismatch",
      "The completed capture and manifest do not describe the same session.",
    );
  if (!SHA256_PATTERN.test(input.manifest.videoSha256 ?? ""))
    throw new PrivateCaptureUploadError(
      "integrity_required",
      "Private transfer requires a complete local integrity hash.",
    );

  const session = await runtime.getSession();
  throwIfAborted(options.signal);
  if (
    !session ||
    session.user.isAnonymous !== false ||
    !isPermanentVisionLabUser(session.user)
  )
    throw new PrivateCaptureUploadError(
      "permanent_owner_required",
      "Sign in with a verified CommandCanvas account before transferring a capture.",
    );
  if (session.user.id !== input.expectedActorId)
    throw new PrivateCaptureUploadError(
      "actor_mismatch",
      "The signed-in account changed before the private transfer began.",
    );

  const manifestBlob = privateCaptureManifestBlob(input.manifest);
  if (manifestBlob.size <= 0 || manifestBlob.size > MAX_MANIFEST_BYTES)
    throw new PrivateCaptureUploadError(
      "capture_invalid",
      "The completed manifest is outside the private transfer limits.",
    );
  const manifestSha256 = await runtime.sha256(manifestBlob);
  if (!SHA256_PATTERN.test(manifestSha256))
    throw new PrivateCaptureUploadError(
      "integrity_required",
      "Private transfer requires a complete local integrity hash.",
    );
  throwIfAborted(options.signal);

  const videoObjectPath = `${session.user.id}/${input.sessionId}/capture.webm`;
  const manifestObjectPath = `${session.user.id}/${input.sessionId}/manifest.json`;
  const overallBytesTotal = input.video.size + manifestBlob.size;
  const reportProgress = (
    file: "video" | "manifest",
    bytesUploaded: number,
    bytesTotal: number,
  ) => {
    const overallBytesUploaded =
      file === "video"
        ? bytesUploaded
        : input.video.size + bytesUploaded;
    options.onProgress?.({
      file,
      bytesUploaded,
      bytesTotal,
      overallBytesUploaded,
      overallBytesTotal,
      percentage: Math.min(
        100,
        Math.round((overallBytesUploaded / overallBytesTotal) * 100),
      ),
    });
  };

  const completedObjectPaths: string[] = [];
  try {
    await uploadBlob(runtime, {
      blob: input.video,
      endpoint,
      accessToken: session.accessToken,
      objectPath: videoObjectPath,
      contentType: "video/webm",
      fingerprint: `commandcanvas-vision-lab-v1:${session.user.id}:${input.sessionId}:capture.webm:${input.video.size}`,
      signal: options.signal,
      onProgress: (uploaded, total) => reportProgress("video", uploaded, total),
    });
    completedObjectPaths.push(videoObjectPath);
    await uploadBlob(runtime, {
      blob: manifestBlob,
      endpoint,
      accessToken: session.accessToken,
      objectPath: manifestObjectPath,
      contentType: "application/json",
      fingerprint: `commandcanvas-vision-lab-v1:${session.user.id}:${input.sessionId}:manifest.json:${manifestBlob.size}`,
      signal: options.signal,
      onProgress: (uploaded, total) => reportProgress("manifest", uploaded, total),
    });
    completedObjectPaths.push(manifestObjectPath);
    throwIfAborted(options.signal);
  } catch (uploadError) {
    if (completedObjectPaths.length > 0) {
      try {
        await runtime.removeObjects(completedObjectPaths, session.accessToken);
      } catch {
        throw new PrivateCaptureUploadError(
          "cleanup_failed",
          "The transfer stopped, but private cleanup could not be confirmed. The local recording is still available.",
        );
      }
    }
    throw uploadError;
  }
  const pendingSubmission: PrivateCaptureSubmissionRow = {
    actor_user_id: session.user.id,
    vision_lab_session_id: input.sessionId,
    capture_type: input.captureType,
    video_object_path: videoObjectPath,
    manifest_object_path: manifestObjectPath,
    video_sha256: input.manifest.videoSha256!,
    manifest_sha256: manifestSha256,
    video_bytes: input.video.size,
    manifest_bytes: manifestBlob.size,
    consent_version: input.manifest.consentVersion,
    protocol_id: input.manifest.protocol.id,
    protocol_version: input.manifest.protocol.version,
    status: "uploaded_unverified",
  };
  const receipt = await finalizePrivateCaptureSubmission(
    pendingSubmission,
    runtime,
    options.signal,
  );

  return {
    submissionId: receipt.submissionId,
    status: "uploaded_unverified",
    videoObjectPath,
    manifestObjectPath,
  };
}
