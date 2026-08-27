import { expect, type Page, type Response } from "@playwright/test";

interface CapturedRoomBody {
  room?: { roomId?: unknown };
}

export function captureCreatedRoom(page: Page) {
  const pendingRoomIds: Array<Promise<string | null>> = [];
  const onResponse = (response: Response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (
      request.method() !== "POST" ||
      url.pathname !== "/api/rooms" ||
      response.status() !== 201
    )
      return;
    pendingRoomIds.push(
      response
        .json()
        .then((body: CapturedRoomBody) =>
          typeof body.room?.roomId === "string" ? body.room.roomId : null,
        )
        .catch(() => null),
    );
  };
  page.on("response", onResponse);

  return {
    async resolveRoomId() {
      const captured = (await Promise.all(pendingRoomIds)).find(Boolean);
      return captured ?? (await readSessionRoomId(page));
    },
    stop() {
      page.off("response", onResponse);
    },
  };
}

export async function readSessionRoomId(page: Page) {
  try {
    return await page.evaluate(() => {
      const raw = sessionStorage.getItem("commandcanvas.demo.room.v1");
      if (!raw) return null;
      const roomId = (JSON.parse(raw) as { roomId?: unknown }).roomId;
      return typeof roomId === "string" ? roomId : null;
    });
  } catch {
    return null;
  }
}

export async function deleteHostedRoom(page: Page, roomId: string) {
  const result = await page.evaluate(async (id) => {
    const authKey = Object.keys(localStorage).find(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    );
    const auth = authKey
      ? (JSON.parse(localStorage.getItem(authKey) ?? "null") as {
          access_token?: string;
        } | null)
      : null;
    if (!auth?.access_token)
      return { status: 0, body: "Browser access token unavailable." };
    const response = await fetch(`/api/rooms/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${auth.access_token}` },
    });
    return { status: response.status, body: await response.text() };
  }, roomId);
  expect(result, `Exact test-room cleanup failed: ${result.body}`).toMatchObject({
    status: 200,
  });
}
