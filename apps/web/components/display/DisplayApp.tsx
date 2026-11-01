"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DisplaySnapshot } from "@liendo/shared";
import { isDimHours, weekDates, WEEKDAY_LABELS } from "@liendo/shared";
import { PairCard } from "@/components/pair/PairCard";
import { useClaim } from "@/components/pair/useClaim";

type View = "home" | "week" | "chores" | "meals";

function eventDay(iso: string) {
  return iso.slice(0, 10);
}

function eventTime(iso: string, allDay: boolean) {
  if (allDay) return "All day";
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function clockLabel(now: string) {
  return new Date(now).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

function dateLabel(now: string) {
  return new Date(now).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

function starsLabel(count: number) {
  return count === 1 ? "1 star" : `${count} stars`;
}

function hourInChicago(now: string) {
  const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }).format(
    new Date(now),
  );
  return Number(hour);
}

export function DisplayApp({ view }: { view: View }) {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [offline, setOffline] = useState(false);
  const claim = useClaim("display");
  const [awakeUntil, setAwakeUntil] = useState(0);
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const me = await fetch("/api/me", { cache: "no-store" });
      if (me.status === 401) {
        setPaired(false);
        return;
      }
      setPaired(true);
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const week = weekDates(today);
      const res = await fetch(`/api/snapshot?from=${week[0]}&to=${week[6]}`, { cache: "no-store" });
      if (!res.ok) throw new Error("snapshot");
      setSnapshot((await res.json()) as DisplaySnapshot);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 30_000);
    const clock = setInterval(() => setTick(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  useEffect(() => {
    if (!claim.paired || paired) return;
    void (async () => {
      setPaired(true);
      await load();
    })();
  }, [claim.paired, load, paired]);

  async function complete(id: string) {
    const res = await fetch(`/api/chores/instances/${id}/complete`, { method: "POST" });
    if (res.ok) await load();
  }

  const today = snapshot ? eventDay(snapshot.now) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);
  const forceDim = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dim") === "1";
  const dim =
    snapshot && (forceDim || isDimHours(hourInChicago(snapshot.now))) && Date.now() > awakeUntil;

  const kids = useMemo(() => {
    const order = ["sofia", "noah", "xavier"];
    return (snapshot?.people ?? [])
      .filter((person) => person.role === "kid")
      .sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  }, [snapshot]);

  if (paired === false) {
    return (
      <main className="kitchen pair-kitchen">
        <header className="mast">
          <h1>Liendo Plaza</h1>
          <p className="small">Kitchen board</p>
        </header>
        <section className="pair-kitchen-body">
          <div>
            <h2>Pair this frame</h2>
            <p className="lead" style={{ marginTop: "var(--space-md)" }}>
              A parent who is already signed in scans the code, or types the short code under Add a device. This board
              then remembers the house.
            </p>
            {claim.error ? <p style={{ color: "var(--color-error)", marginTop: "var(--space-md)" }}>{claim.error}</p> : null}
          </div>
          {claim.claim ? (
            <PairCard
              qrDataUrl={claim.claim.qrDataUrl}
              displayCode={claim.claim.displayCode}
              title="Scan or type"
              hint="Expires in about ten minutes. One use."
            />
          ) : (
            <p className="small">Getting a pairing code ready.</p>
          )}
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="kitchen">
        <header className="mast">
          <h1>Liendo Plaza</h1>
          <p className="small">{offline ? "Waiting on the house network." : "Getting today ready."}</p>
        </header>
      </main>
    );
  }

  const todayEvents = snapshot.events.filter((event) => eventDay(event.start) === today);
  const dinner = snapshot.meals.find((meal) => meal.date === today)?.name ?? "Nothing written yet";
  const nav = (
    <nav className="kitchen-nav" aria-label="Board">
      <Link href="/display" aria-current={view === "home" ? "page" : undefined}>
        Today
      </Link>
      <Link href="/display/week" aria-current={view === "week" ? "page" : undefined}>
        Week
      </Link>
      <Link href="/display/chores" aria-current={view === "chores" ? "page" : undefined}>
        Chores
      </Link>
      <Link href="/display/meals" aria-current={view === "meals" ? "page" : undefined}>
        Dinners
      </Link>
    </nav>
  );

  return (
    <main className="kitchen">
      <header className="mast">
        <div>
          <p className="clock" data-testid="clock">{clockLabel(snapshot.now)}</p>
          <p className="date">{dateLabel(snapshot.now)}</p>
        </div>
        <div className="mast-aside">
          <p className="weather num">
            {snapshot.weather ? `${snapshot.weather.temperatureF}° ${snapshot.weather.label}` : "Weather later"}
          </p>
          <p className="place">Davenport</p>
          {nav}
        </div>
      </header>

      {view === "home" ? (
        <>
          <section className="events">
            <h2>Today</h2>
            <div className="list" style={{ marginTop: "var(--space-md)" }}>
              {todayEvents.length === 0 ? <p>Nothing on the calendar.</p> : null}
              {todayEvents.map((event) => (
                <article key={`${event.uid}-${event.start}`} className="row">
                  <span>{event.title}</span>
                  <span className="small num">{eventTime(event.start, event.allDay)}</span>
                </article>
              ))}
            </div>
          </section>
          <section className="bento">
            <section className="kids">
              {kids.map((kid) => {
                const chores = snapshot.chores.filter((item) => item.personId === kid.id && item.date === today);
                const stars = snapshot.stars.find((item) => item.personId === kid.id);
                return (
                  <article key={kid.id} className="kid" style={{ ["--person" as string]: kid.color }}>
                    <h3>{kid.name}</h3>
                    <p className="stars">{stars?.weekEarned ?? 0} this week</p>
                    <p className="stars">{stars?.balance ?? 0} to spend</p>
                    {chores.length === 0 ? <p className="stars">No chores today.</p> : null}
                    {chores.map((chore) => {
                      const canTap = !chore.requiresPhoto && chore.status === "open";
                      const done = chore.status === "done";
                      return (
                        <button
                          key={chore.id}
                          type="button"
                          className="chore-btn tap"
                          data-status={chore.status}
                          disabled={!canTap}
                          aria-label={chore.title}
                          onClick={() => void complete(chore.id)}
                        >
                          <span>{chore.title}</span>
                          {done ? null : <span className="small">{starsLabel(chore.stars)}</span>}
                          {!done && chore.requiresPhoto ? <span className="small">photo on the phone</span> : null}
                          {chore.status === "pending" ? <span className="small">waiting</span> : null}
                        </button>
                      );
                    })}
                  </article>
                );
              })}
            </section>
            <aside className="dinner">
              <p className="place">Tonight’s dinner</p>
              <p className="dinner-name">{dinner}</p>
              <div className="dinner-week">
                {week
                  .filter((iso) => iso !== today)
                  .map((iso) => (
                    <p key={iso} className="dinner-week-row">
                      <span className="day-name">{WEEKDAY_LABELS[week.indexOf(iso)]}</span>
                      <span>{snapshot.meals.find((meal) => meal.date === iso)?.name ?? "Not written yet"}</span>
                    </p>
                  ))}
              </div>
            </aside>
          </section>
        </>
      ) : null}

      {view === "week" ? (
        <section className="week-grid">
          {week.map((iso, index) => (
            <div key={iso} className="day-col">
              <p className="day-name">{WEEKDAY_LABELS[index]} {iso.slice(8)}</p>
              {snapshot.events
                .filter((event) => eventDay(event.start) === iso)
                .map((event) => (
                  <p key={`${event.uid}-${event.start}`}>{event.title}</p>
                ))}
            </div>
          ))}
        </section>
      ) : null}

      {view === "chores" ? (
        <section className="week-grid">
          {week.map((iso, index) => (
            <div key={iso} className="day-col">
              <p className="day-name">{WEEKDAY_LABELS[index]}</p>
              {snapshot.chores
                .filter((item) => item.date === iso)
                .map((chore) => {
                  const person = snapshot.people.find((row) => row.id === chore.personId);
                  return (
                    <p
                      key={chore.id}
                      className="chore-chip"
                      style={{ ["--person" as string]: person?.color ?? "var(--color-ink)" }}
                    >
                      {chore.title}
                      <span className="small"> {person?.name}</span>
                    </p>
                  );
                })}
            </div>
          ))}
        </section>
      ) : null}

      {view === "meals" ? (
        <section className="week-grid">
          {week.map((iso, index) => (
            <div key={iso} className="day-col">
              <p className="day-name">{WEEKDAY_LABELS[index]}</p>
              <h3>{snapshot.meals.find((meal) => meal.date === iso)?.name ?? "—"}</h3>
            </div>
          ))}
        </section>
      ) : null}

      {offline ? <p className="banner">The board will catch up when the network does.</p> : null}
      {dim ? (
        <button type="button" className="dim" onClick={() => setAwakeUntil(Date.now() + 5 * 60 * 1000)}>
          <span className="clock">{clockLabel(snapshot.now)}</span>
        </button>
      ) : null}
      <span className="visually-hidden">{tick}</span>
    </main>
  );
}
