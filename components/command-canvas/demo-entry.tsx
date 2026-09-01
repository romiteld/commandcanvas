"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { useDocumentWebMcpTarget } from "@/lib/webmcp/use-document-target";

const DEMO_ENTRY_ACCEPTED_KEY = "commandcanvas.demo-entry.accepted.v1";
const DEMO_ENTRY_ACCEPTED_EVENT = "commandcanvas:demo-entry-accepted";

function subscribeToDemoEntry(onChange: () => void) {
  window.addEventListener(DEMO_ENTRY_ACCEPTED_EVENT, onChange);
  return () => window.removeEventListener(DEMO_ENTRY_ACCEPTED_EVENT, onChange);
}

function readStoredDemoEntry() {
  try {
    return window.sessionStorage.getItem(DEMO_ENTRY_ACCEPTED_KEY) === "accepted";
  } catch {
    return false;
  }
}

function subscribeToClientMount() {
  return () => undefined;
}

function readMountedClient() {
  return true;
}

function readMountedServer() {
  return false;
}

export function DemoEntry({ children }: { children: ReactNode }) {
  const storedAccepted = useSyncExternalStore(
    subscribeToDemoEntry,
    readStoredDemoEntry,
    () => false,
  );
  const [memoryAccepted, setMemoryAccepted] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    readMountedClient,
    readMountedServer,
  );
  const accepted = storedAccepted || memoryAccepted;
  const siteToolsSurfaceAvailable = useDocumentWebMcpTarget() !== null;

  function acceptPreview() {
    try {
      window.sessionStorage.setItem(DEMO_ENTRY_ACCEPTED_KEY, "accepted");
      window.dispatchEvent(new Event(DEMO_ENTRY_ACCEPTED_EVENT));
    } catch {
      // The current in-memory entry still works when storage is unavailable.
      setMemoryAccepted(true);
    }
  }

  if (accepted) return children;

  return (
    <main className="demo-gate demo-entry" aria-labelledby="demo-entry-title">
      <span className="demo-gate-mark" aria-hidden="true">
        CC
      </span>
      <p className="eyebrow">CommandCanvas / choose an entry</p>
      <h1 id="demo-entry-title">Choose how to enter CommandCanvas</h1>
      <p>
        Sign in for durable rooms, invitations, and your encrypted saved OpenAI
        key. In the ChatGPT desktop app, Site Tools use the ChatGPT account
        already signed into the surrounding app. CommandCanvas never receives
        that ChatGPT credential.
      </p>
      <p className="demo-entry-site-tools" role="status">
        {siteToolsSurfaceAvailable
          ? "A Site Tools registration surface is available in this tab. The surface itself does not prove which agent host exposed it; an actual invocation is shown separately after you enter."
          : "This browser session has not exposed a Site Tools registration surface. No additional ChatGPT sign-in is required; the preview still works with visible canvas controls."}
      </p>
      <div className="demo-entry-actions">
        <button
          className="demo-entry-primary"
          type="button"
          disabled={!mounted}
          onClick={acceptPreview}
        >
          Enter no-signup preview
        </button>
        <Link className="demo-entry-secondary" href="/meet">
          Use durable workspace with email OTP
        </Link>
      </div>
      <p className="demo-entry-boundary">
        The judge preview uses your existing signed-in CommandCanvas identity,
        or creates a temporary Supabase identity when none exists. A capped room
        is allocated only after you continue. Anonymous no-signup users can
        enter a temporary key held only in this tab. A permanent
        email-authenticated CommandCanvas identity can save and reuse only its
        own credential through server-side Supabase Vault. No deployment-owner
        OpenAI key is shared, and the preview cannot send production email.
      </p>
    </main>
  );
}
