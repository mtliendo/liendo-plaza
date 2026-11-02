"use client";

import { useEffect, useMemo, useState } from "react";
import { DISPLAY_REFETCH_MS, isDimHours, mealPhotoSrc, queryKeys, weekDates, WEEKDAY_LABELS } from "@liendo/shared";
import { EventBoard } from "@/components/EventBoard";
import { PersonAvatar } from "@/components/PersonAvatar";
import { SoftLink } from "@/components/SoftLink";
import { PairCard } from "@/components/pair/PairCard";
import { useClaim } from "@/components/pair/useClaim";
import { useKitchenReload } from "@/lib/display-refresh";
import { useChoreToggle, useMe, usePrefetchHouse, useSnapshot, useSoftView } from "@/lib/query";
import { useQueryClient } from "@tanstack/react-query";

type View = "home" | "week" | "chores" | "meals";

function eventDay(iso: string) {
  return iso.slice(0, 10);
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

const DISPLAY_HREFS = {
  home: "/display",
  week: "/display/week",
  chores: "/display/chores",
  meals: "/display/meals",
} as const;

export function DisplayApp({ view }: { view: View }) {
  const [boardView, go] = useSoftView(view, DISPLAY_HREFS);
  const me = useMe();
  const paired = me.data ? Boolean(me.data.actor) : me.isPending ? null : false;
  const snapshotQuery = useSnapshot(paired === true, DISPLAY_REFETCH_MS);
  const snapshot = snapshotQuery.data ?? null;
  const offline = snapshotQuery.isError;
  const toggle = useChoreToggle();
  const prefetch = usePrefetchHouse();
  const queryClient = useQueryClient();
  const claim = useClaim("display");
  const [awakeUntil, setAwakeUntil] = useState(0);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const clock = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!claim.paired) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [claim.paired, queryClient]);

  useEffect(() => {
    if (paired) prefetch();
  }, [paired, prefetch]);

  const today = snapshot ? eventDay(snapshot.now) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);
  const forceDim = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dim") === "1";
  const dim = Boolean(
    snapshot && (forceDim || isDimHours(hourInChicago(snapshot.now))) && Date.now() > awakeUntil,
  );
  useKitchenReload(dim);

  const kids = useMemo(() => {
    const order = ["sofia", "noah", "xavier"];
    return (snapshot?.people ?? [])
      .filter((person) => person.role === "kid")
      .sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  }, [snapshot]);

  if (paired === false) {
    return (
      <main className="kitchen pair-kitchen" data-testid="kitchen-pair">
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

  const tonight = snapshot.meals.find((meal) => meal.date === today);
  const dinner = tonight?.name ?? "Nothing written yet";
  const dinnerPhoto = mealPhotoSrc(tonight?.photoPath);
  const nav = (
    <nav className="kitchen-nav" aria-label="Board">
      <SoftLink href="/display" current={boardView === "home"} onGo={() => go("home")} onPrefetch={prefetch}>
        Today
      </SoftLink>
      <SoftLink href="/display/week" current={boardView === "week"} onGo={() => go("week")} onPrefetch={prefetch}>
        Week
      </SoftLink>
      <SoftLink href="/display/chores" current={boardView === "chores"} onGo={() => go("chores")} onPrefetch={prefetch}>
        Chores
      </SoftLink>
      <SoftLink href="/display/meals" current={boardView === "meals"} onGo={() => go("meals")} onPrefetch={prefetch}>
        Dinners
      </SoftLink>
    </nav>
  );

  const mast = (
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
  );

  return (
    <main className={`kitchen ${boardView === "home" ? "kitchen-home" : ""}`} data-testid={`view-${boardView}`}>
      {boardView === "home" ? (
        <>
          <div className="kitchen-top">
            {mast}
            <EventBoard
              heading="Today"
              className="events-folio"
              events={snapshot.events}
              now={snapshot.now}
              people={snapshot.people}
              maxVisible={6}
              moreHref="/display/week"
            />
          </div>
          <section className="bento">
            <section className="kids">
              {kids.map((kid) => {
                const chores = snapshot.chores.filter((item) => item.personId === kid.id && item.date === today);
                const stars = snapshot.stars.find((item) => item.personId === kid.id);
                const choreMax = 3;
                const visibleChores = chores.slice(0, choreMax);
                const choreMore = chores.length - visibleChores.length;
                return (
                  <article key={kid.id} className="kid" style={{ ["--person" as string]: kid.color }}>
                    <div className="kid-head">
                      <PersonAvatar person={kid} size={96} />
                      <h3>{kid.name}</h3>
                    </div>
                    <p className="stars">{stars?.weekEarned ?? 0} this week</p>
                    <p className="stars">{stars?.balance ?? 0} to spend</p>
                    <div className="kid-chores">
                      {chores.length === 0 ? <p className="stars">No chores today.</p> : null}
                      {visibleChores.map((chore) => {
                        const canTap = (!chore.requiresPhoto && chore.status === "open") || chore.status === "done";
                        const done = chore.status === "done";
                        return (
                          <button
                            key={chore.id}
                            type="button"
                            className="chore-btn tap"
                            data-testid={`chore-${chore.title}`}
                            data-status={chore.status}
                            disabled={!canTap}
                            aria-label={chore.title}
                            onClick={() =>
                              void toggle.mutate({ id: chore.id, undo: chore.status === "done" })
                            }
                          >
                            <span>{chore.title}</span>
                            {done ? null : <span className="small">{starsLabel(chore.stars)}</span>}
                            {!done && chore.requiresPhoto ? <span className="small">photo on the phone</span> : null}
                            {chore.status === "pending" ? <span className="small">waiting</span> : null}
                          </button>
                        );
                      })}
                      {choreMore > 0 ? (
                        <SoftLink
                          href="/display/chores"
                          className="events-more tap"
                          onGo={() => go("chores")}
                          onPrefetch={prefetch}
                        >
                          +{choreMore} more
                        </SoftLink>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>
            <aside className="dinner" data-has-photo={dinnerPhoto ? "true" : "false"}>
              {dinnerPhoto ? (
                <div className="dinner-poster">
                  <img src={dinnerPhoto} alt="" className="dinner-photo" />
                </div>
              ) : null}
              <p className="place">Tonight’s dinner</p>
              <p className="dinner-name">{dinner}</p>
              <div className="dinner-week">
                {week
                  .filter((iso) => iso !== today)
                  .map((iso) => {
                    const meal = snapshot.meals.find((row) => row.date === iso);
                    const thumb = mealPhotoSrc(meal?.photoPath);
                    return (
                      <p key={iso} className="dinner-week-row">
                        <span className="day-name">{WEEKDAY_LABELS[week.indexOf(iso)]}</span>
                        <span className="meal-line">
                          {thumb ? <img src={thumb} alt="" className="meal-thumb" /> : null}
                          <span>{meal?.name ?? "Not written yet"}</span>
                        </span>
                      </p>
                    );
                  })}
              </div>
            </aside>
          </section>
        </>
      ) : null}

      {boardView !== "home" ? mast : null}

      {boardView === "week" ? (
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

      {boardView === "chores" ? (
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
                      {person ? (
                        <span className="name-line small">
                          <PersonAvatar person={person} size={40} />
                          {person.name}
                        </span>
                      ) : null}
                    </p>
                  );
                })}
            </div>
          ))}
        </section>
      ) : null}

      {boardView === "meals" ? (
        <section className="week-grid">
          {week.map((iso, index) => (
            <div key={iso} className="day-col">
              <p className="day-name">{WEEKDAY_LABELS[index]}</p>
              {(() => {
                const meal = snapshot.meals.find((row) => row.date === iso);
                const thumb = mealPhotoSrc(meal?.photoPath);
                return (
                  <div className="meal-line">
                    {thumb ? <img src={thumb} alt="" className="meal-thumb" /> : null}
                    <h3>{meal?.name ?? "—"}</h3>
                  </div>
                );
              })()}
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
