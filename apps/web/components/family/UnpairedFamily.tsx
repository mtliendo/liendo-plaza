"use client";

import { useEffect, useState } from "react";
import type { Person } from "@liendo/shared";
import { PairCard } from "@/components/pair/PairCard";
import { useClaim } from "@/components/pair/useClaim";

export function UnpairedFamily({
  invite,
  onReady,
}: {
  invite: string | null;
  onReady: (familyToken: string | null) => void;
}) {
  const claim = useClaim("browser");
  const [bootstrap, setBootstrap] = useState<{ available: boolean; parents: Person[] } | null>(null);
  const [picked, setPicked] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pair/status", { cache: "no-store" });
      const body = (await res.json()) as { available: boolean; parents: Person[] };
      setBootstrap(body);
    })();
  }, []);

  useEffect(() => {
    if (!invite) return;
    void (async () => {
      setBusy(true);
      const res = await fetch("/api/pair/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite }),
      });
      const body = (await res.json()) as { familyToken?: string; error?: string };
      setBusy(false);
      if (!res.ok || !body.familyToken) {
        setError(body.error ?? "That invite did not work.");
        return;
      }
      onReady(body.familyToken);
    })();
  }, [invite, onReady]);

  useEffect(() => {
    if (claim.familyToken) onReady(claim.familyToken);
  }, [claim.familyToken, onReady]);

  async function bootstrapSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!picked) return;
    setError("");
    setBusy(true);
    const res = await fetch("/api/pair/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: picked.id, pin, cookie: true, deviceKind: "browser" }),
    });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "That PIN is wrong.");
      return;
    }
    onReady(null);
  }

  return (
    <main className="phone">
      <p className="small">Liendo Plaza</p>
      <h1>Who is home?</h1>
      {busy && invite ? <p>Opening this phone…</p> : null}

      {bootstrap?.available ? (
        <section className="list">
          <p>This is the first parent phone. Pick your name and enter your 6-digit PIN. Nobody else needs a long secret.</p>
          {!picked ? (
            bootstrap.parents.map((person) => (
              <button
                key={person.id}
                type="button"
                className="btn person-pick"
                data-testid={`bootstrap-${person.slug}`}
                style={{ ["--person" as string]: person.color }}
                onClick={() => setPicked(person)}
              >
                {person.name}
              </button>
            ))
          ) : (
            <form onSubmit={bootstrapSubmit} className="list">
              <p>{picked.name}</p>
              <label className="field">
                <span>6-digit PIN</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoComplete="off"
                  data-testid="bootstrap-pin"
                />
              </label>
              <button className="btn" type="submit" disabled={busy} data-testid="bootstrap-open">
                Open the house
              </button>
              <button type="button" className="btn-secondary btn" onClick={() => setPicked(null)}>
                Someone else
              </button>
            </form>
          )}
        </section>
      ) : (
        <p>Ask a parent who is already signed in to approve this phone, or to show a new-phone QR under Add a device.</p>
      )}

      <section>
        <h2>Or pair from another parent</h2>
        {claim.claim ? (
          <PairCard
            compact
            qrDataUrl={claim.claim.qrDataUrl}
            displayCode={claim.claim.displayCode}
            title="This phone’s code"
            hint="They can scan it or type the code on Add a device."
          />
        ) : (
          <p className="small">Getting a pairing code ready.</p>
        )}
      </section>
      {error || claim.error ? <p style={{ color: "var(--color-error)" }}>{error || claim.error}</p> : null}
    </main>
  );
}
