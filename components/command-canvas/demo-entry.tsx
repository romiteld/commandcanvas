"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

export function DemoEntry({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState(false);

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
        key. ChatGPT Site Tools use the ChatGPT account already signed into the
        surrounding ChatGPT app.
      </p>
      <div className="demo-entry-actions">
        <Link className="demo-entry-primary" href="/meet">
          Sign in to CommandCanvas
        </Link>
        <button
          type="button"
          onClick={() => setAccepted(true)}
        >
          Continue limited judge preview
        </button>
      </div>
      <p className="demo-entry-boundary">
        The judge preview uses your existing signed-in CommandCanvas identity,
        or creates a temporary Supabase identity when none exists. A capped room
        is allocated only after you continue. It does not save an OpenAI key and
        cannot send production email.
      </p>
    </main>
  );
}
