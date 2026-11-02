"use client";

import { useCallback, useEffect, useState } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";

type Pending = { id: string; displayCode: string; label: string | null; deviceKind: string; expiresAt: string };
type Device = {
  id: string;
  kind: string;
  label: string;
  personName: string | null;
  personColor: string | null;
  personAvatarKey: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};
type Invite = { webUrl: string; deepLink: string; qrDataUrl: string; expiresAt: string };

export function AddDevicePanel() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPending = useCallback(async () => {
    const res = await fetch("/api/pair/pending", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { requests: Pending[] };
    setPending(body.requests);
  }, []);

  useEffect(() => {
    void loadPending();
    const timer = setInterval(() => void loadPending(), 4000);
    return () => clearInterval(timer);
  }, [loadPending]);

  async function approve(nextCode: string) {
    setError("");
    setMessage("");
    const res = await fetch("/api/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: nextCode }),
    });
    const body = (await res.json()) as { error?: string; label?: string; displayCode?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not approve that device.");
      return;
    }
    setMessage(`${body.label ?? "That device"} (${body.displayCode}) is approved.`);
    setCode("");
    await loadPending();
  }

  async function invitePhone() {
    setError("");
    const res = await fetch("/api/pair/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceKind: "phone" }),
    });
    const body = (await res.json()) as Invite & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not make an invite.");
      return;
    }
    setInvite(body);
  }

  return (
    <>
      <h1>Add a device</h1>
      <p>Approve the kitchen frame or another phone that is showing a short code, or make a one-time QR for a new phone.</p>

      <form
        className="list"
        onSubmit={(event) => {
          event.preventDefault();
          void approve(code);
        }}
      >
        <label className="field">
          <span>Short code from the other screen</span>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="off"
            placeholder="AB3-K7M"
            data-testid="approve-code"
          />
        </label>
        <button className="btn" type="submit" data-testid="approve-submit">
          Approve this device
        </button>
      </form>

      {pending.length > 0 ? (
        <section className="list">
          <h2>Waiting</h2>
          {pending.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chore-btn"
              onClick={() => void approve(item.displayCode)}
            >
              <strong>{item.displayCode}</strong>
              <span className="small">
                {item.label ?? item.deviceKind}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      <button className="btn" type="button" onClick={() => void invitePhone()} data-testid="invite-phone">
        Invite a new phone
      </button>

      {invite ? (
        <div className="pair-card pair-card-compact" id="invite-card">
          <p className="small">New phone scans this</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={invite.qrDataUrl} alt="Invite QR code" className="pair-qr" data-testid="invite-qr" />
          <p className="small" data-testid="invite-url">
            {invite.webUrl}
          </p>
          <p className="small">{invite.deepLink}</p>
          <p className="small">One use. Expires in about ten minutes.</p>
        </div>
      ) : null}

      {message ? <p>{message}</p> : null}
      {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}
    </>
  );
}

export function DevicesPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/devices", { cache: "no-store" });
    const body = (await res.json()) as { devices?: Device[]; error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not load devices.");
      return;
    }
    setDevices(body.devices ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setError("");
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Could not revoke that device.");
      return;
    }
    await load();
  }

  return (
    <>
      <h1>Paired devices</h1>
      <div className="list">
        {devices.length === 0 ? <p>No devices yet.</p> : null}
        {devices.map((device) => (
          <article key={device.id} className="row" data-testid="device-row">
            <div>
              <strong>{device.label}</strong>
              <p className="small">{device.kind}</p>
              {device.personName ? (
                <p className="small name-line">
                  <PersonAvatar
                    person={{
                      name: device.personName,
                      color: device.personColor ?? "var(--color-ink)",
                      avatarKey: device.personAvatarKey,
                    }}
                    size={40}
                  />
                  {device.personName}
                </p>
              ) : null}
              {device.lastSeenAt ? (
                <p className="small">last seen {new Date(device.lastSeenAt).toLocaleString("en-US")}</p>
              ) : null}
            </div>
            <button type="button" className="btn-secondary btn" onClick={() => void revoke(device.id)}>
              Revoke
            </button>
          </article>
        ))}
      </div>
      {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}
    </>
  );
}
