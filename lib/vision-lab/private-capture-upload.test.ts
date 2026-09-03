import { describe, expect, it, vi } from "vitest";

import {
  TUS_CHUNK_BYTES,
  PrivateCaptureUploadError,
  finalizePrivateCaptureSubmission,
  privateCaptureManifestBlob,
  uploadPrivateVisionLabCapture,
  type PrivateCaptureUploadRuntime,
  type VisionLabTusOptions,
  type VisionLabTusUpload,
} from "@/lib/vision-lab/private-capture-upload";
import {
  createVisionLabManifest,
  type VisionLabManifest,
} from "@/lib/vision-lab/capture-contract";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "vision-lab-22222222-2222-4222-8222-222222222222";
const VIDEO_HASH = "a".repeat(64);
const MANIFEST_HASH = "b".repeat(64);

function manifest(): VisionLabManifest {
  return createVisionLabManifest({
    sessionId: SESSION_ID,
    captureType: "drawing",
    startedAt: "2026-09-02T19:00:00.000Z",
    stoppedAt: "2026-09-02T19:00:30.000Z",
    media: {
      mimeType: "video/webm;codecs=vp8",
      width: 1280,
      height: 720,
      frameRate: 30,
      facingMode: "user",
    },
    mirrorDisplay: true,
    videoSha256: VIDEO_HASH,
  });
}

function createRuntime(options: {
  anonymous?: boolean;
  failObjectName?: string;
  failCleanup?: boolean;
  neverComplete?: boolean;
  neverCompleteObjectName?: string;
  afterObjectSuccess?: (objectName: string) => void;
} = {}) {
  const uploadCalls: Array<{
    blob: Blob;
    options: VisionLabTusOptions;
    abort: ReturnType<typeof vi.fn>;
  }> = [];
  const inserted: unknown[] = [];
  const removed: Array<{ paths: string[]; accessToken: string }> = [];
  const runtime: PrivateCaptureUploadRuntime = {
    supabaseUrl: "https://project-ref.supabase.co",
    publishableKey: "sb_publishable_public_test_value",
    getSession: vi.fn(async () => ({
      accessToken: "header.payload.signature",
      user: {
        id: OWNER_ID,
        email: "owner@example.com",
        emailConfirmedAt: "2026-09-02T18:00:00.000Z",
        isAnonymous: options.anonymous ?? false,
      },
    })),
    sha256: vi.fn(async () => MANIFEST_HASH),
    insertSubmission: vi.fn(async (row) => {
      inserted.push(row);
      return { id: "33333333-3333-4333-8333-333333333333", status: "uploaded_unverified" };
    }),
    removeObjects: vi.fn(async (paths, accessToken) => {
      removed.push({ paths: [...paths], accessToken });
      if (options.failCleanup) throw new Error("provider cleanup detail");
    }),
    createTusUpload(blob, tusOptions): VisionLabTusUpload {
      const abort = vi.fn(async () => undefined);
      const upload: VisionLabTusUpload = {
        findPreviousUploads: vi.fn(async () => []),
        resumeFromPreviousUpload: vi.fn(),
        start: vi.fn(() => {
          if (
            options.neverComplete ||
            tusOptions.metadata.objectName === options.neverCompleteObjectName
          )
            return;
          queueMicrotask(() => {
            if (tusOptions.metadata.objectName === options.failObjectName)
              tusOptions.onError(new Error("provider detail must not escape"));
            else {
              tusOptions.onProgress(blob.size, blob.size);
              tusOptions.onSuccess();
              options.afterObjectSuccess?.(tusOptions.metadata.objectName);
            }
          });
        }),
        abort,
      };
      uploadCalls.push({ blob, options: tusOptions, abort });
      return upload;
    },
  };
  return { runtime, uploadCalls, inserted, removed };
}

function uploadInput() {
  return {
    expectedActorId: OWNER_ID,
    sessionId: SESSION_ID,
    captureType: "drawing" as const,
    video: new Blob(["raw-camera-bytes"], {
      type: "video/webm;codecs=vp8",
    }),
    manifest: manifest(),
  };
}

describe("private Vision Lab capture upload", () => {
  it("uploads both artifacts through the direct TUS hostname before writing one immutable receipt", async () => {
    const setup = createRuntime();
    const progress = vi.fn();

    const result = await uploadPrivateVisionLabCapture(
      uploadInput(),
      setup.runtime,
      { onProgress: progress },
    );

    expect(setup.uploadCalls).toHaveLength(2);
    expect(setup.uploadCalls.map(({ options }) => options.endpoint)).toEqual([
      "https://project-ref.storage.supabase.co/storage/v1/upload/resumable",
      "https://project-ref.storage.supabase.co/storage/v1/upload/resumable",
    ]);
    expect(setup.uploadCalls.map(({ options }) => options.metadata.objectName)).toEqual([
      `${OWNER_ID}/${SESSION_ID}/capture.webm`,
      `${OWNER_ID}/${SESSION_ID}/manifest.json`,
    ]);
    for (const { options } of setup.uploadCalls) {
      expect(options.chunkSize).toBe(TUS_CHUNK_BYTES);
      expect(options.retryDelays).toEqual([0, 3_000, 5_000, 10_000, 20_000]);
      expect(options.headers).toEqual({
        authorization: "Bearer header.payload.signature",
        apikey: "sb_publishable_public_test_value",
      });
      expect(options.headers).not.toHaveProperty("x-upsert");
      expect(options.uploadDataDuringCreation).toBe(true);
      expect(options.removeFingerprintOnSuccess).toBe(true);
    }
    expect(
      await setup.uploadCalls[0]!.options.fingerprint(
        setup.uploadCalls[0]!.blob,
      ),
    ).toBe(
      `commandcanvas-vision-lab-v1:${OWNER_ID}:${SESSION_ID}:capture.webm:${setup.uploadCalls[0]!.blob.size}`,
    );
    expect(setup.inserted).toEqual([
      {
        actor_user_id: OWNER_ID,
        vision_lab_session_id: SESSION_ID,
        capture_type: "drawing",
        video_object_path: `${OWNER_ID}/${SESSION_ID}/capture.webm`,
        manifest_object_path: `${OWNER_ID}/${SESSION_ID}/manifest.json`,
        video_sha256: VIDEO_HASH,
        manifest_sha256: MANIFEST_HASH,
        video_bytes: 16,
        manifest_bytes: privateCaptureManifestBlob(manifest()).size,
        consent_version: "vision-lab-consent-v1",
        protocol_id: "commandcanvas-hand-finetune",
        protocol_version: 1,
        status: "uploaded_unverified",
      },
    ]);
    expect(result).toEqual({
      submissionId: "33333333-3333-4333-8333-333333333333",
      status: "uploaded_unverified",
      videoObjectPath: `${OWNER_ID}/${SESSION_ID}/capture.webm`,
      manifestObjectPath: `${OWNER_ID}/${SESSION_ID}/manifest.json`,
    });
    expect(progress).toHaveBeenLastCalledWith({
      file: "manifest",
      bytesUploaded: privateCaptureManifestBlob(manifest()).size,
      bytesTotal: privateCaptureManifestBlob(manifest()).size,
      overallBytesUploaded: 16 + privateCaptureManifestBlob(manifest()).size,
      overallBytesTotal: 16 + privateCaptureManifestBlob(manifest()).size,
      percentage: 100,
    });
  });

  it("rejects anonymous sessions before creating an upload or receipt", async () => {
    const setup = createRuntime({ anonymous: true });

    await expect(
      uploadPrivateVisionLabCapture(uploadInput(), setup.runtime),
    ).rejects.toMatchObject({ code: "permanent_owner_required" });

    expect(setup.uploadCalls).toEqual([]);
    expect(setup.inserted).toEqual([]);
  });

  it("rejects a session that does not explicitly identify the user as non-anonymous", async () => {
    const setup = createRuntime();
    setup.runtime.getSession = vi.fn(async () => ({
      accessToken: "header.payload.signature",
      user: {
        id: OWNER_ID,
        email: "owner@example.com",
        emailConfirmedAt: "2026-09-02T18:00:00.000Z",
      },
    }));

    await expect(
      uploadPrivateVisionLabCapture(uploadInput(), setup.runtime),
    ).rejects.toMatchObject({ code: "permanent_owner_required" });

    expect(setup.uploadCalls).toEqual([]);
    expect(setup.inserted).toEqual([]);
  });

  it("rejects actor, manifest, and integrity mismatches before network work", async () => {
    const setup = createRuntime();
    const wrongActor = { ...uploadInput(), expectedActorId: crypto.randomUUID() };
    const wrongManifest = {
      ...uploadInput(),
      manifest: { ...manifest(), sessionId: "vision-lab-wrong-session" },
    };
    const missingHash = {
      ...uploadInput(),
      manifest: { ...manifest(), videoSha256: undefined },
    } as unknown as ReturnType<typeof uploadInput>;

    await expect(
      uploadPrivateVisionLabCapture(wrongActor, setup.runtime),
    ).rejects.toMatchObject({ code: "actor_mismatch" });
    await expect(
      uploadPrivateVisionLabCapture(wrongManifest, setup.runtime),
    ).rejects.toMatchObject({ code: "manifest_mismatch" });
    await expect(
      uploadPrivateVisionLabCapture(missingHash, setup.runtime),
    ).rejects.toMatchObject({ code: "integrity_required" });
    expect(setup.uploadCalls).toEqual([]);
    expect(setup.inserted).toEqual([]);
  });

  it("does not create a success receipt when the second artifact fails", async () => {
    const setup = createRuntime({
      failObjectName: `${OWNER_ID}/${SESSION_ID}/manifest.json`,
    });

    await expect(
      uploadPrivateVisionLabCapture(uploadInput(), setup.runtime),
    ).rejects.toMatchObject({ code: "storage_upload_failed" });

    expect(setup.uploadCalls).toHaveLength(2);
    expect(setup.inserted).toEqual([]);
    expect(setup.removed).toEqual([
      {
        paths: [`${OWNER_ID}/${SESSION_ID}/capture.webm`],
        accessToken: "header.payload.signature",
      },
    ]);
  });

  it("does not call a partial transfer cancelled when private cleanup cannot be confirmed", async () => {
    const setup = createRuntime({
      failObjectName: `${OWNER_ID}/${SESSION_ID}/manifest.json`,
      failCleanup: true,
    });

    await expect(
      uploadPrivateVisionLabCapture(uploadInput(), setup.runtime),
    ).rejects.toMatchObject({ code: "cleanup_failed" });

    expect(setup.inserted).toEqual([]);
  });

  it("retries receipt finalization without uploading completed objects again", async () => {
    const setup = createRuntime();
    setup.runtime.insertSubmission = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost after object upload"))
      .mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
        status: "uploaded_unverified",
      });

    let pendingSubmission;
    try {
      await uploadPrivateVisionLabCapture(uploadInput(), setup.runtime);
      throw new Error("expected receipt finalization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateCaptureUploadError);
      expect(error).toMatchObject({ code: "receipt_failed" });
      pendingSubmission = (error as PrivateCaptureUploadError).pendingSubmission;
    }
    expect(pendingSubmission).toBeDefined();
    expect(setup.uploadCalls).toHaveLength(2);

    const receipt = await finalizePrivateCaptureSubmission(
      pendingSubmission!,
      setup.runtime,
    );

    expect(receipt).toEqual({
      submissionId: "33333333-3333-4333-8333-333333333333",
      status: "uploaded_unverified",
    });
    expect(setup.uploadCalls).toHaveLength(2);
    expect(setup.runtime.insertSubmission).toHaveBeenCalledTimes(2);
  });

  it("terminates an in-flight TUS upload when the caller aborts", async () => {
    const setup = createRuntime({ neverComplete: true });
    const controller = new AbortController();
    const result = uploadPrivateVisionLabCapture(uploadInput(), setup.runtime, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(setup.uploadCalls).toHaveLength(1));

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(setup.uploadCalls[0]!.abort).toHaveBeenCalledWith(true);
    expect(setup.inserted).toEqual([]);
  });

  it("removes the completed video when the manifest transfer is cancelled", async () => {
    const setup = createRuntime({
      neverCompleteObjectName: `${OWNER_ID}/${SESSION_ID}/manifest.json`,
    });
    const controller = new AbortController();
    const result = uploadPrivateVisionLabCapture(uploadInput(), setup.runtime, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(setup.uploadCalls).toHaveLength(2));

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(setup.uploadCalls[1]!.abort).toHaveBeenCalledWith(true);
    expect(setup.removed).toEqual([
      {
        paths: [`${OWNER_ID}/${SESSION_ID}/capture.webm`],
        accessToken: "header.payload.signature",
      },
    ]);
    expect(setup.inserted).toEqual([]);
  });

  it("removes both objects when cancellation lands immediately after manifest success", async () => {
    const controller = new AbortController();
    const setup = createRuntime({
      afterObjectSuccess: (objectName) => {
        if (objectName === `${OWNER_ID}/${SESSION_ID}/manifest.json`)
          controller.abort();
      },
    });

    await expect(
      uploadPrivateVisionLabCapture(uploadInput(), setup.runtime, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(setup.removed).toEqual([
      {
        paths: [
          `${OWNER_ID}/${SESSION_ID}/capture.webm`,
          `${OWNER_ID}/${SESSION_ID}/manifest.json`,
        ],
        accessToken: "header.payload.signature",
      },
    ]);
    expect(setup.inserted).toEqual([]);
  });
});
