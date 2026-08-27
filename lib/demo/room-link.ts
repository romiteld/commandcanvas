import { z } from "zod";

const STORAGE_KEY = "commandcanvas.demo.room.v1";

const slugSchema = z
  .string()
  .min(12)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const joinTokenSchema = z
  .string()
  .min(43)
  .max(86)
  .regex(/^[A-Za-z0-9_-]+$/);
const commonDescriptorFields = {
  roomId: z.uuid(),
  slug: slugSchema,
  displayName: z.string().trim().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
};

const storedDemoRoomSchema = z.discriminatedUnion("role", [
  z
    .object({
      ...commonDescriptorFields,
      role: z.literal("host"),
      joinToken: joinTokenSchema,
    })
    .strict(),
  z
    .object({
      ...commonDescriptorFields,
      role: z.literal("participant"),
      joinToken: z.never().optional(),
    })
    .strict(),
]);

export type StoredDemoRoom = z.infer<typeof storedDemoRoomSchema>;

interface DemoSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => unknown;
  removeItem: (key: string) => unknown;
}

export function parseDemoJoinLink(searchParams: URLSearchParams) {
  const parsed = z
    .object({ slug: slugSchema, joinToken: joinTokenSchema })
    .strict()
    .safeParse({
      slug: searchParams.get("room"),
      joinToken: searchParams.get("join"),
    });
  return parsed.success ? parsed.data : null;
}

export function createDemoInviteUrl(
  origin: string,
  slug: string,
  joinToken: string,
) {
  const parsed = z
    .object({ slug: slugSchema, joinToken: joinTokenSchema })
    .safeParse({ slug, joinToken });
  if (!parsed.success) throw new Error("Demo room invite is invalid.");

  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username !== "" ||
    base.password !== ""
  )
    throw new Error("Demo room origin is invalid.");

  const invite = new URL("/demo", base.origin);
  invite.searchParams.set("room", parsed.data.slug);
  invite.searchParams.set("join", parsed.data.joinToken);
  return invite.toString();
}

export function readStoredDemoRoom(
  storage: DemoSessionStorage,
): StoredDemoRoom | null {
  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (serialized === null) return null;
    const parsed = storedDemoRoomSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeDemoRoom(
  storage: DemoSessionStorage,
  descriptor: unknown,
) {
  const parsed = storedDemoRoomSchema.safeParse(descriptor);
  if (!parsed.success) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredDemoRoom(storage: DemoSessionStorage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Reset remains best-effort if storage is disabled; the next page load will
    // still create a new room after the in-memory descriptor is cleared.
  }
}
