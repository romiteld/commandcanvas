import { describe, expect, it, vi } from "vitest";

import {
  createBrowserPrivateCaptureUploadRuntime,
  type PrivateCaptureSubmissionRow,
  type VisionLabTusOptions,
} from "@/lib/vision-lab/private-capture-upload";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function submission(): PrivateCaptureSubmissionRow {
  return {
    actor_user_id: OWNER_ID,
    vision_lab_session_id: "vision-lab-22222222-2222-4222-8222-222222222222",
    capture_type: "drawing",
    video_object_path: `${OWNER_ID}/vision-lab-22222222-2222-4222-8222-222222222222/capture.webm`,
    manifest_object_path: `${OWNER_ID}/vision-lab-22222222-2222-4222-8222-222222222222/manifest.json`,
    video_sha256: "a".repeat(64),
    manifest_sha256: "b".repeat(64),
    video_bytes: 1_000,
    manifest_bytes: 500,
    consent_version: "vision-lab-consent-v1",
    protocol_id: "commandcanvas-hand-finetune",
    protocol_version: 1,
    status: "uploaded_unverified",
  };
}

describe("browser private capture runtime", () => {
  it("maps the current Supabase session without treating it as a client authorization decision", async () => {
    const getSession = vi.fn(async () => ({
      data: {
        session: {
          access_token: "header.payload.signature",
          user: {
            id: OWNER_ID,
            email: "owner@example.com",
            email_confirmed_at: "2026-09-02T18:00:00.000Z",
            is_anonymous: false,
          },
        },
      },
      error: null,
    }));
    const runtime = createBrowserPrivateCaptureUploadRuntime({
      supabaseUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_public_test_value",
      client: { auth: { getSession }, rpc: vi.fn() },
      createTusUpload: vi.fn(),
      sha256: vi.fn(),
    });

    await expect(runtime.getSession()).resolves.toEqual({
      accessToken: "header.payload.signature",
      user: {
        id: OWNER_ID,
        email: "owner@example.com",
        emailConfirmedAt: "2026-09-02T18:00:00.000Z",
        isAnonymous: false,
      },
    });
  });

  it("finalizes through the idempotent RPC and forwards cancellation", async () => {
    const abortSignal = vi.fn();
    const response = Promise.resolve({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        status: "uploaded_unverified",
      },
      error: null,
    });
    const builder = {
      abortSignal: vi.fn((signal: AbortSignal) => {
        abortSignal(signal);
        return response;
      }),
      then: response.then.bind(response),
    };
    const rpc = vi.fn(() => builder);
    const runtime = createBrowserPrivateCaptureUploadRuntime({
      supabaseUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_public_test_value",
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        },
        rpc,
      },
      createTusUpload: vi.fn(),
      sha256: vi.fn(),
    });
    const controller = new AbortController();

    await expect(
      runtime.insertSubmission(submission(), controller.signal),
    ).resolves.toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      status: "uploaded_unverified",
    });

    expect(rpc).toHaveBeenCalledWith("finalize_vision_lab_capture_submission", {
      p_vision_lab_session_id: "vision-lab-22222222-2222-4222-8222-222222222222",
      p_capture_type: "drawing",
      p_video_object_path: `${OWNER_ID}/vision-lab-22222222-2222-4222-8222-222222222222/capture.webm`,
      p_manifest_object_path: `${OWNER_ID}/vision-lab-22222222-2222-4222-8222-222222222222/manifest.json`,
      p_video_sha256: "a".repeat(64),
      p_manifest_sha256: "b".repeat(64),
      p_video_bytes: 1_000,
      p_manifest_bytes: 500,
      p_consent_version: "vision-lab-consent-v1",
      p_protocol_id: "commandcanvas-hand-finetune",
      p_protocol_version: 1,
    });
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("constructs TUS uploads only through the injected browser adapter", () => {
    const tusUpload = {
      findPreviousUploads: vi.fn(),
      resumeFromPreviousUpload: vi.fn(),
      start: vi.fn(),
      abort: vi.fn(),
    };
    const createTusUpload = vi.fn(() => tusUpload);
    const runtime = createBrowserPrivateCaptureUploadRuntime({
      supabaseUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_public_test_value",
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        },
        rpc: vi.fn(),
      },
      createTusUpload,
      sha256: vi.fn(),
    });
    const blob = new Blob(["capture"]);
    const options = { endpoint: "https://storage.example" } as VisionLabTusOptions;

    expect(runtime.createTusUpload(blob, options)).toBe(tusUpload);
    expect(createTusUpload).toHaveBeenCalledWith(blob, options);
  });

  it("deletes completed partial-transfer objects with the captured owner token", async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    const runtime = createBrowserPrivateCaptureUploadRuntime({
      supabaseUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_public_test_value",
      client: {
        auth: {
          getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        },
        rpc: vi.fn(),
      },
      createTusUpload: vi.fn(),
      sha256: vi.fn(),
      fetch: fetcher,
    });

    await runtime.removeObjects(
      [
        `${OWNER_ID}/vision-lab-22222222-2222-4222-8222-222222222222/capture.webm`,
      ],
      "header.payload.signature",
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://project-ref.supabase.co/storage/v1/object/vision-lab-captures",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer header.payload.signature",
          apikey: "sb_publishable_public_test_value",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prefixes: [
            `${OWNER_ID}/vision-lab-22222222-2222-4222-8222-222222222222/capture.webm`,
          ],
        }),
      },
    );
  });
});
