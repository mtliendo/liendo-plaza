"use client";

import { isDimHours } from "@liendo/shared";
import { useEffect, useState } from "react";

export function shouldPollDisplay(now: number, visible: boolean, awakeUntil = 0): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago",
  }).format(now));
  return visible && (!isDimHours(hour) || now < awakeUntil);
}

export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
