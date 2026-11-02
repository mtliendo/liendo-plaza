"use client";

import { useCallback, useEffect, useState } from "react";

export type ClaimPayload = {
  id: string;
  shortCode: string;
  displayCode: string;
  pairUrl: string;
  qrDataUrl: string;
  pollSecret: string;
  expiresAt: string;
};

export function useClaim(deviceKind: "display" | "phone" | "browser") {
  const [claim, setClaim] = useState<ClaimPayload | null>(null);
  const [error, setError] = useState("");
  const [familyToken, setFamilyToken] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  const start = useCallback(async () => {
    setError("");
    setFamilyToken(null);
    setPaired(false);
    const res = await fetch("/api/pair/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceKind }),
    });
    const body = (await res.json()) as ClaimPayload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not start pairing.");
      return;
    }
    setClaim(body);
  }, [deviceKind]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (!claim) return;
    let cancelled = false;
    const tick = async () => {
      const res = await fetch("/api/pair/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: claim.id, pollSecret: claim.pollSecret }),
      });
      const body = (await res.json()) as { status?: string; familyToken?: string; error?: string };
      if (cancelled) return;
      if (body.status === "paired") {
        if (body.familyToken) setFamilyToken(body.familyToken);
        setPaired(true);
        return;
      }
      if (body.status === "expired") {
        void start();
      }
    };
    const poll = setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [claim, start]);

  return { claim, error, familyToken, paired, restart: start };
}
