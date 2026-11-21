"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { Person } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { FamilyCodeGate } from "@/components/family/FamilyCodes";
import { formatPairCode } from "@/lib/pair-format";

function PairApprove() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [me, setMe] = useState<Person | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function loadMe() {
    const res = await fetch("/api/me", { cache: "no-store" });
    const body = res.ok ? ((await res.json()) as { actor?: { kind: string; person?: Person } }) : null;
    setMe(body?.actor?.kind === "person" ? body.actor.person ?? null : null);
    setLoaded(true);
  }

  useEffect(() => {
    void loadMe().catch(() => setLoaded(true));
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

  if (!loaded) return <main className="phone"><p>Getting ready.</p></main>;
  if (!me) return <FamilyCodeGate onReady={loadMe} />;

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
