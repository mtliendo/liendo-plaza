"use client";

import { useEffect, useRef } from "react";
import {
  DISPLAY_RELOAD_IDLE_MS,
  DISPLAY_REMOTE_REFRESH_MAX_WAIT_MS,
  DISPLAY_VERSION_POLL_MS,
  type DisplayVersion,
} from "@liendo/shared";

type Pending = { kind: "version" | "remote"; since: number };

function timing() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number) => {
    const raw = params.get(key);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    pollMs: number("pollMs", DISPLAY_VERSION_POLL_MS),
    idleMs: number("idleMs", DISPLAY_RELOAD_IDLE_MS),
    maxWaitMs: number("maxWaitMs", DISPLAY_REMOTE_REFRESH_MAX_WAIT_MS),
  };
}

async function readVersion(): Promise<DisplayVersion | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as DisplayVersion;
    if (!body.buildId) return null;
    return {
      buildId: body.buildId,
      refreshRequestedAt: body.refreshRequestedAt ?? null,
    };
  } catch {
    return null;
  }
}

export function useKitchenReload(dimmed: boolean) {
  const loadedAtRef = useRef(Date.now());
  const loadedBuildIdRef = useRef<string | null>(null);
  const lastTouchRef = useRef(Date.now());
  const pendingRef = useRef<Pending | null>(null);
  const dimmedRef = useRef(dimmed);
  dimmedRef.current = dimmed;

  useEffect(() => {
    const { pollMs, idleMs, maxWaitMs } = timing();
    let cancelled = false;
    let waitTimer: number | undefined;

    const reload = () => {
      if (cancelled) return;
      window.location.reload();
    };
    (window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady = loadedAtRef.current;

    const remainingWait = () => {
      const pending = pendingRef.current;
      if (!pending) return null;
      if (dimmedRef.current) return 0;
      const idleLeft = idleMs - (Date.now() - lastTouchRef.current);
      const maxLeft =
        pending.kind === "remote" ? pending.since + maxWaitMs - Date.now() : Number.POSITIVE_INFINITY;
      return Math.max(0, Math.min(idleLeft, maxLeft));
    };

    const schedule = () => {
      window.clearTimeout(waitTimer);
      if (!pendingRef.current) return;
      const wait = remainingWait();
      if (wait === null) return;
      if (wait <= 0) {
        reload();
        return;
      }
      waitTimer = window.setTimeout(schedule, wait);
    };

    const notePending = (kind: Pending["kind"]) => {
      if (!pendingRef.current) pendingRef.current = { kind, since: Date.now() };
      else if (kind === "remote" && pendingRef.current.kind === "version") {
        pendingRef.current = { kind, since: Date.now() };
      }
      schedule();
    };

    const onTouch = () => {
      lastTouchRef.current = Date.now();
      if (pendingRef.current) schedule();
    };

    const consider = (version: DisplayVersion) => {
      if (!loadedBuildIdRef.current) {
        loadedBuildIdRef.current = version.buildId;
      } else if (version.buildId !== loadedBuildIdRef.current) {
        notePending("version");
      }
      if (version.refreshRequestedAt) {
        const requested = Date.parse(version.refreshRequestedAt);
        if (Number.isFinite(requested) && requested > loadedAtRef.current) {
          notePending("remote");
        }
      }
    };

    const poll = async () => {
      const version = await readVersion();
      if (cancelled || !version) return;
      consider(version);
    };

    window.addEventListener("pointerdown", onTouch, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("keydown", onTouch);
    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(waitTimer);
      window.removeEventListener("pointerdown", onTouch);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("keydown", onTouch);
    };
  }, []);

  useEffect(() => {
    if (dimmed && pendingRef.current) window.location.reload();
  }, [dimmed]);
}
