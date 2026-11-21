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
  const [personId, setPersonId] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [kids, setKids] = useState<Record<string, string>>({});
  const [parentCodes, setParentCodes] = useState<Record<string, string>>({});
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
  async function submit() {
    setBusy(true); setError("");
    try {
      await request(status?.setupRequired ? "auth/codes/setup" : "auth/login", {
        code, confirmation, personId: status?.setupRequired ? personId : undefined,
        parents: Object.entries(parentCodes).filter(([id, code]) => id !== personId && code).map(([personId, code]) => ({ personId, code })),
        kids: Object.entries(kids).filter(([, code]) => code).map(([personId, code]) => ({ personId, code })),
        cookie: true, deviceKind: "browser",
      });
      setCode(""); setConfirmation(""); await onReady();
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
    <h1>{status?.setupRequired ? "Set up Liendo Plaza" : "Enter your code"}</h1>
    {!status ? <><p>Getting ready.</p>{error ? <button className="btn" onClick={() => { setError(""); setRetry(retry + 1); }}>Try again</button> : null}</> :
      <form className="list" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {status.setupRequired ? <label className="field"><span>Sign in as</span><select className="select" value={personId} onChange={(event) => { setPersonId(event.target.value); setCode(""); setConfirmation(""); setParentCodes({}); }}>{status.people.filter((p) => p.role === "parent").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}
        <label className="field"><span>{status.setupRequired ? "Parent code (6+ digits)" : "Enter your code"}</span>
          <input className="input" type="password" inputMode="numeric" autoComplete={status.setupRequired ? "new-password" : "current-password"} value={code} onChange={(event) => setCode(event.target.value)} required maxLength={72} /></label>
        {status.setupRequired ? <>
          <label className="field"><span>Enter parent code again</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={72} /></label>
          {status.people.filter((p) => p.role === "parent" && p.id !== personId).map((p) => <label key={p.id} className="field"><span>{p.name} code (optional, 6+ digits)</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={72} value={parentCodes[p.id] ?? ""} onChange={(event) => setParentCodes({ ...parentCodes, [p.id]: event.target.value })} /></label>)}
          <p>Optional: each kid’s birthday as four digits (MMDD). You can set these later under Family codes.</p>
          {status.people.filter((p) => p.role === "kid").map((p) => <label key={p.id} className="field"><span>{p.name} code (optional)</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={kids[p.id] ?? ""} onChange={(event) => setKids({ ...kids, [p.id]: event.target.value })} /></label>)}
        </> : null}
        <button className="btn" disabled={busy} type="submit">{busy ? "Opening…" : status.setupRequired ? "Set up and sign in" : "Open"}</button>
      </form>}
    {error ? <p role="alert" style={{ color: "var(--color-error)" }}>{error}</p> : null}
  </main>;
}

export function FamilyCodeSettings({ people }: { people: Person[] }) {
  const [personId, setPersonId] = useState(people.find((p) => p.role === "parent")?.id ?? "");
  const [configured, setConfigured] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isParent = people.find((p) => p.id === personId)?.role === "parent";
  const canClear = !isParent || people.some((p) => p.role === "parent" && p.id !== personId && configured?.includes(p.id));
  useEffect(() => { if (!personId) setPersonId(people.find((p) => p.role === "parent")?.id ?? ""); }, [people, personId]);
  useEffect(() => { void request("auth/codes").then((result) => setConfigured(result.configuredPersonIds)).catch((error: Error) => setMessage(error.message)); }, []);
  return <><h1>Family codes</h1><p>Each parent has their own code of 6 or more digits. Each kid has a different four-digit birthday code (MMDD). Leave a code empty to clear it. Existing signed-in devices stay signed in.</p>
    {configured ? <ul>{people.map((p) => <li key={p.id}>{p.name}: {configured.includes(p.id) ? "Set" : "Not set"}</li>)}</ul> : null}
    <form className="list" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setMessage("");
      try { await request("auth/codes", { personId, code, confirmation }); setConfigured((current) => code ? [...(current ?? []).filter((id) => id !== personId), personId] : (current ?? []).filter((id) => id !== personId)); setCode(""); setConfirmation(""); setMessage(code ? "Code saved." : "Code cleared."); }
      catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
    }}>
      <label className="field"><span>Who</span><select className="select" value={personId} onChange={(event) => { setPersonId(event.target.value); setCode(""); setConfirmation(""); setMessage(""); }}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>{isParent ? "New parent code (6+ digits)" : "New kid code (4 digits; leave empty to clear)"}</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={isParent ? 72 : 4} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      {isParent && code ? <label className="field"><span>Enter parent code again</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label> : null}
      {isParent && !canClear ? <p>Keep at least one parent code. Enter a new code to replace this one.</p> : null}
      <button className="btn" disabled={busy || (!code && !canClear)} type="submit">{!code && canClear ? "Clear code" : "Save code"}</button>
    </form>{message ? <p role="status">{message}</p> : null}</>;
}
