"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { Person } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { formatPairCode } from "@/lib/pair-format";

function PairApprove() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [me, setMe] = useState<Person | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { actor?: { kind: string; person?: Person } };
      if (body.actor?.kind === "person") setMe(body.actor.person ?? null);
    })();
  }, []);

  async function approve() {
    setError("");
    const res = await fetch("/api/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await res.json()) as { error?: string; label?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not approve that device.");
      return;
    }
    setDone(true);
    setMessage(`${body.label ?? "That device"} is approved. It should open on its own.`);
  }

  if (!me) {
    return (
      <main className="phone">
        <h1>Sign in first</h1>
        <p>A parent who is already paired opens this link to approve the other screen.</p>
        <Link className="btn" href="/family">
          Open on this phone
        </Link>
      </main>
    );
  }

  if (me.role !== "parent") {
    return (
      <main className="phone">
        <h1>Ask a parent</h1>
        <p>Only a parent can pair a new device.</p>
        <Link href="/family">Back</Link>
      </main>
    );
  }

  return (
    <main className="phone">
      <p className="small phone-who">
        <PersonAvatar person={me} size={40} />
        {me.name}
      </p>
      <h1>Approve a device</h1>
      <p className="pair-code num">{formatPairCode(code)}</p>
      {done ? (
        <p>{message}</p>
      ) : (
        <button className="btn" type="button" onClick={() => void approve()} data-testid="approve-scan">
          Approve this device
        </button>
      )}
      {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}
      <Link href="/family/add-device">Add a device</Link>
    </main>
  );
}

export default function FamilyPairPage() {
  return (
    <Suspense>
      <PairApprove />
    </Suspense>
  );
}
