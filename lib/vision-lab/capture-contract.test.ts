import { describe, expect, it, vi } from "vitest";

import {
  createVisionLabManifest,
  isPermanentVisionLabUser,
  selectSupportedWebmMime,
  stopVisionLabTracks,
} from "@/lib/vision-lab/capture-contract";

describe("Vision Lab capture contract", () => {
  it("selects an explicit supported WebM video MIME before capture", () => {
    expect(
      selectSupportedWebmMime(
        (type) => type === "video/webm;codecs=vp8",
      ),
    ).toBe("video/webm;codecs=vp8");
  });

  it("refuses capture when the browser cannot record WebM", () => {
    expect(selectSupportedWebmMime(() => false)).toBeNull();
  });

  it("refuses an anonymous, unconfirmed, or missing account before capture", () => {
    expect(
      isPermanentVisionLabUser({
        id: "owner-1",
        email: "owner@example.com",
        emailConfirmedAt: "2026-09-02T14:00:00.000Z",
        isAnonymous: true,
      }),
    ).toBe(false);
    expect(
      isPermanentVisionLabUser({
        id: "owner-1",
        email: "owner@example.com",
        isAnonymous: false,
      }),
    ).toBe(false);
    expect(isPermanentVisionLabUser(null)).toBe(false);
  });

  it("accepts only a confirmed non-anonymous owner", () => {
    expect(
      isPermanentVisionLabUser({
        id: "owner-1",
        email: "owner@example.com",
        emailConfirmedAt: "2026-09-02T14:00:00.000Z",
        isAnonymous: false,
      }),
    ).toBe(true);
  });

  it("emits a stable downloadable manifest without raw media", () => {
    const manifest = createVisionLabManifest({
      sessionId: "vision-lab-owner-1-0001",
      captureType: "pinch",
      startedAt: "2026-09-02T14:00:00.000Z",
      stoppedAt: "2026-09-02T14:00:10.000Z",
      media: {
        mimeType: "video/webm",
        width: 1280,
        height: 720,
        frameRate: 30,
        facingMode: "user",
      },
      mirrorDisplay: true,
      videoSha256: "abc123",
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      sessionId: "vision-lab-owner-1-0001",
      captureType: "pinch",
      startedAt: "2026-09-02T14:00:00.000Z",
      stoppedAt: "2026-09-02T14:00:10.000Z",
      media: {
        mimeType: "video/webm",
        width: 1280,
        height: 720,
        frameRate: 30,
        facingMode: "user",
      },
      mirrorDisplay: true,
      consentVersion: "vision-lab-consent-v1",
      protocol: { id: "commandcanvas-hand-finetune", version: 1 },
      videoSha256: "abc123",
    });
    expect(JSON.stringify(manifest)).toBe(
      '{"schemaVersion":1,"sessionId":"vision-lab-owner-1-0001","captureType":"pinch","startedAt":"2026-09-02T14:00:00.000Z","stoppedAt":"2026-09-02T14:00:10.000Z","media":{"mimeType":"video/webm","width":1280,"height":720,"frameRate":30,"facingMode":"user"},"mirrorDisplay":true,"consentVersion":"vision-lab-consent-v1","protocol":{"id":"commandcanvas-hand-finetune","version":1},"videoSha256":"abc123"}',
    );
    expect(JSON.stringify(manifest)).not.toContain("videoBytes");
  });

  it("stops every acquired track when capture ends", () => {
    const video = { stop: vi.fn() };
    const audio = { stop: vi.fn() };

    stopVisionLabTracks({ getTracks: () => [video, audio] });

    expect(video.stop).toHaveBeenCalledOnce();
    expect(audio.stop).toHaveBeenCalledOnce();
  });
});
