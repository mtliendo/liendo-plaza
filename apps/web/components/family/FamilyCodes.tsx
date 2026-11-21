"use client";

import { useEffect, useState } from "react";
import type { Person } from "@liendo/shared";

async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Please try again.");
  return result;
}

export function FamilyCodeGate({ onReady }: { onReady: () => Promise<void> }) {
  const [status, setStatus] = useState<{ setupRequired: boolean; people: Person[] } | null>(null);
  const [parents, setParents] = useState<Person[]>([]);
  const [personId, setPersonId] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [kids, setKids] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void request("auth/codes/status").then((result) => {
      if (!cancelled) { setStatus(result); setPersonId(result.people.find((p: Person) => p.role === "parent")?.id ?? ""); }
    }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [retry]);
  async function submit(picked?: string) {
    setBusy(true); setError("");
    try {
      const result = await request(status?.setupRequired ? "auth/codes/setup" : "auth/login", {
        code, confirmation, personId: picked ?? (status?.setupRequired ? personId : undefined),
        kids: Object.entries(kids).filter(([, code]) => code).map(([personId, code]) => ({ personId, code })),
        cookie: true, deviceKind: "browser",
      });
      if (result.parents) setParents(result.parents);
      else { setCode(""); setConfirmation(""); await onReady(); }
    } catch (error) {
      setError((error as Error).message);
      if (status?.setupRequired) {
        const latest = await request("auth/codes/status").catch(() => null);
        if (latest && !latest.setupRequired) { setStatus(latest); setCode(""); setConfirmation(""); setKids({}); }
      }
    }
    finally { setBusy(false); }
  }
  return <main className="phone">
    <p className="small">Liendo Plaza</p>
    <h1>{status?.setupRequired ? "Set up Liendo Plaza" : parents.length ? "Who are you?" : "Enter your code"}</h1>
    {!status ? <><p>Getting ready.</p>{error ? <button className="btn" onClick={() => { setError(""); setRetry(retry + 1); }}>Try again</button> : null}</> :
      parents.length ? <div className="list">{parents.map((person) => <button className="btn" key={person.id} disabled={busy} onClick={() => void submit(person.id)}>{person.name}</button>)}
        <button className="btn-secondary btn" disabled={busy} onClick={() => { setParents([]); setCode(""); }}>Use another code</button></div> :
      <form className="list" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field"><span>{status.setupRequired ? "Parent code (6+ digits)" : "Enter your code"}</span>
          <input className="input" type="password" inputMode="numeric" autoComplete={status.setupRequired ? "new-password" : "current-password"} value={code} onChange={(event) => setCode(event.target.value)} required maxLength={72} /></label>
        {status.setupRequired ? <>
          <label className="field"><span>Enter parent code again</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={72} /></label>
          <label className="field"><span>Sign in as</span><select className="select" value={personId} onChange={(event) => setPersonId(event.target.value)}>{status.people.filter((p) => p.role === "parent").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <p>Optional: each kid’s birthday as four digits (MMDD). You can set these later under Family codes.</p>
          {status.people.filter((p) => p.role === "kid").map((p) => <label key={p.id} className="field"><span>{p.name} code (optional)</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={kids[p.id] ?? ""} onChange={(event) => setKids({ ...kids, [p.id]: event.target.value })} /></label>)}
        </> : null}
        <button className="btn" disabled={busy} type="submit">{busy ? "Opening…" : status.setupRequired ? "Set up and sign in" : "Open"}</button>
      </form>}
    {error ? <p role="alert" style={{ color: "var(--color-error)" }}>{error}</p> : null}
  </main>;
}

export function FamilyCodeSettings({ people }: { people: Person[] }) {
  const [personId, setPersonId] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <><h1>Family codes</h1><p>One shared parent code. A different four-digit birthday code (MMDD) for each kid. Existing signed-in devices stay signed in.</p>
    <form className="list" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setMessage("");
      try { await request("auth/codes", { personId: personId || undefined, code, confirmation }); setCode(""); setConfirmation(""); setMessage(code ? "Code saved." : "Kid code cleared."); }
      catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
    }}>
      <label className="field"><span>Who</span><select className="select" value={personId} onChange={(event) => { setPersonId(event.target.value); setCode(""); setConfirmation(""); setMessage(""); }}><option value="">Shared parent code</option>{people.filter((p) => p.role === "kid").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>{personId ? "New kid code (4 digits; leave empty to clear)" : "New parent code (6+ digits)"}</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={personId ? 4 : 72} required={!personId} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      {!personId ? <label className="field"><span>Enter parent code again</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label> : null}
      <button className="btn" disabled={busy} type="submit">{personId && !code ? "Clear kid code" : "Save code"}</button>
    </form>{message ? <p role="status">{message}</p> : null}</>;
}
