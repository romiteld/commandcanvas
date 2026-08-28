import { invitationTokenSchema } from "@/lib/supabase/meeting-contracts";

export interface MeetingInviteLocation {
  href: string;
  replaceState: (data: unknown, unused: string, url: string) => void;
}

/**
 * Reads fragment capability material synchronously and removes it from browser
 * history before callers create clients, fetch, log, or render third parties.
 */
export function readAndScrubMeetingInvite(
  location: MeetingInviteLocation,
): string | null {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return null;
  }

  const hadQueryToken = url.searchParams.has("invite");
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const fragmentToken = fragment.get("invite");
  const hadFragment = url.hash.length > 0;

  if (hadQueryToken) url.searchParams.delete("invite");
  if (hadFragment || hadQueryToken)
    location.replaceState(
      null,
      "",
      `${url.pathname}${url.search}`,
    );

  if (hadQueryToken || fragment.size !== 1 || fragmentToken === null) return null;
  const parsed = invitationTokenSchema.safeParse(fragmentToken);
  return parsed.success ? parsed.data : null;
}
