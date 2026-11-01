"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Chore, DisplaySnapshot, Person, Reward, RewardRequest } from "@liendo/shared";
import { WEEKDAY_LABELS, weekDates } from "@liendo/shared";
import { AddDevicePanel, DevicesPanel } from "@/components/family/DevicePanels";
import { UnpairedFamily } from "@/components/family/UnpairedFamily";

type Screen =
  | "gate"
  | "people"
  | "pin"
  | "today"
  | "calendar"
  | "meals"
  | "stars"
  | "manage-chores"
  | "approvals"
  | "rewards"
  | "plan-meals"
  | "pins"
  | "devices"
  | "add-device";

function eventDay(iso: string) {
  return iso.slice(0, 10);
}

export function FamilyApp({ screen }: { screen: Exclude<Screen, "gate" | "people" | "pin"> }) {
  return (
    <Suspense fallback={<main className="phone"><p>Getting ready.</p></main>}>
      <FamilyAppInner screen={screen} />
    </Suspense>
  );
}

function FamilyAppInner({ screen }: { screen: Exclude<Screen, "gate" | "people" | "pin"> }) {
  const params = useSearchParams();
  const invite = params.get("invite");
  const [familyToken, setFamilyToken] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<Person | null>(null);
  const [phase, setPhase] = useState<Screen>("gate");
  const [pin, setPin] = useState("");
  const [picked, setPicked] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [requests, setRequests] = useState<RewardRequest[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const today = snapshot ? eventDay(snapshot.now) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);

  const headers = useMemo(() => {
    const next: Record<string, string> = { "content-type": "application/json" };
    if (familyToken) next["x-family-token"] = familyToken;
    return next;
  }, [familyToken]);

  const loadAll = useCallback(async () => {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    if (!meRes.ok) return false;
    const meBody = (await meRes.json()) as { actor?: { kind: string; person?: Person } };
    if (meBody.actor?.kind === "person" && meBody.actor.person) {
      setMe(meBody.actor.person);
      const from = weekDates(today)[0];
      const to = weekDates(today)[6];
      const [snap, choreRes, rewardRes, requestRes] = await Promise.all([
        fetch(`/api/snapshot?from=${from}&to=${to}`).then((r) => r.json()) as Promise<DisplaySnapshot>,
        fetch("/api/chores").then((r) => r.json()) as Promise<{ chores: Chore[] }>,
        fetch("/api/rewards").then((r) => r.json()) as Promise<{ rewards: Reward[] }>,
        fetch("/api/rewards/requests").then((r) => r.json()) as Promise<{ requests: RewardRequest[] }>,
      ]);
      setSnapshot(snap);
      setChores(choreRes.chores);
      setRewards(rewardRes.rewards);
      setRequests(requestRes.requests);
      return true;
    }
    return false;
  }, [today]);

  useEffect(() => {
    void (async () => {
      if (await loadAll()) {
        setPhase(screen);
        return;
      }
      if (!familyToken) return;
      const peopleRes = await fetch("/api/people", { headers: { "x-family-token": familyToken } });
      if (peopleRes.ok) {
        const body = (await peopleRes.json()) as { people: Person[] };
        setPeople(body.people);
        setPhase("people");
      }
    })();
  }, [familyToken, loadAll, screen]);

  const onPaired = useCallback((token: string | null) => {
    if (token) {
      setFamilyToken(token);
      return;
    }
    void (async () => {
      if (await loadAll()) setPhase(screen);
    })();
  }, [loadAll, screen]);

  async function submitPin(event: React.FormEvent) {
    event.preventDefault();
    if (!picked) return;
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ familyToken, personId: picked.id, pin, cookie: true, deviceKind: "browser" }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "That PIN is wrong.");
      return;
    }
    await loadAll();
    setPhase(screen);
  }

  const isParent = me?.role === "parent";
  const visibleChores =
    snapshot?.chores.filter((item) => (isParent ? true : item.personId === me?.id) && item.date === today) ?? [];

  if (phase === "gate") {
    return <UnpairedFamily invite={invite} onReady={onPaired} />;
  }

  if (phase === "people") {
    return (
      <main className="phone">
        <h1>Pick your name</h1>
        <div className="list">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              className="btn-secondary btn"
              style={{ borderLeft: `6px solid ${person.color}`, justifyContent: "flex-start" }}
              onClick={() => {
                setPicked(person);
                setPhase("pin");
              }}
            >
              {person.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (phase === "pin" && picked) {
    return (
      <main className="phone">
        <h1>{picked.name}</h1>
        <form onSubmit={submitPin} className="list">
          <label className="field">
            <span>{picked.role === "parent" ? "6-digit PIN" : "4-digit PIN"}</span>
            <input
              className="input"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}
          <button className="btn" type="submit">
            Open
          </button>
        </form>
      </main>
    );
  }

  const tabs = (
    <nav className="tabs">
      <Link href="/family" aria-current={screen === "today" ? "page" : undefined}>
        Today
      </Link>
      <Link href="/family/calendar" aria-current={screen === "calendar" ? "page" : undefined}>
        Week
      </Link>
      <Link href="/family/meals" aria-current={screen === "meals" ? "page" : undefined}>
        Dinner
      </Link>
      <Link href="/family/stars" aria-current={screen === "stars" ? "page" : undefined}>
        Stars
      </Link>
    </nav>
  );

  return (
    <main className="phone">
      <p className="small">{me?.name}</p>
      {screen === "today" ? (
        <>
          <h1>Today</h1>
          {isParent ? (
            <div className="list">
              <Link href="/family/approvals">Approvals</Link>
              <Link href="/family/chores">Edit chores</Link>
              <Link href="/family/rewards">Rewards</Link>
              <Link href="/family/plan">Plan dinners</Link>
              <Link href="/family/add-device">Add a device</Link>
              <Link href="/family/devices">Devices</Link>
              <Link href="/family/pins">PINs</Link>
            </div>
          ) : null}
          <div className="list">
            {visibleChores.map((chore) => (
              <button
                key={chore.id}
                type="button"
                className="chore-btn"
                onClick={async () => {
                  if (chore.requiresPhoto || chore.status !== "open") return;
                  await fetch(`/api/chores/instances/${chore.id}/complete`, { method: "POST" });
                  await loadAll();
                }}
              >
                {chore.title}
                <span className="small">
                  {chore.status}
                  {chore.requiresPhoto ? " · photo" : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {screen === "calendar" && snapshot ? (
        <>
          <h1>This week</h1>
          {week.map((iso, index) => (
            <section key={iso}>
              <h2>{WEEKDAY_LABELS[index]}</h2>
              {snapshot.events
                .filter((event) => eventDay(event.start) === iso)
                .map((event) => (
                  <p key={`${event.uid}-${event.start}`}>{event.title}</p>
                ))}
            </section>
          ))}
        </>
      ) : null}

      {screen === "meals" && snapshot ? (
        <>
          <h1>Dinners</h1>
          {week.map((iso) => (
            <p key={iso} className="row">
              <span>{iso.slice(5)}</span>
              <span>{snapshot.meals.find((meal) => meal.date === iso)?.name ?? "—"}</span>
            </p>
          ))}
        </>
      ) : null}

      {screen === "stars" && snapshot ? (
        <>
          <h1>Stars</h1>
          {snapshot.stars.map((row) => (
            <p key={row.personId} className="row" style={{ borderLeft: `6px solid ${row.color}`, paddingLeft: 12 }}>
              <span>{row.personName}</span>
              <span>
                {row.balance} to spend · {row.weekEarned} this week
              </span>
            </p>
          ))}
          <h2>Ask for a reward</h2>
          {rewards
            .filter((reward) => reward.active)
            .map((reward) => (
              <button
                key={reward.id}
                type="button"
                className="chore-btn"
                onClick={async () => {
                  await fetch("/api/rewards/requests", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ rewardId: reward.id }),
                  });
                  await loadAll();
                }}
              >
                {reward.name}
                <span className="small">{reward.starCost} stars</span>
              </button>
            ))}
        </>
      ) : null}

      {screen === "manage-chores" && isParent ? (
        <>
          <h1>Chores</h1>
          <ChoreForm
            people={snapshot?.people.filter((p) => p.role === "kid") ?? []}
            onCreate={async (payload) => {
              await fetch("/api/chores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
              await loadAll();
            }}
          />
          {chores
            .filter((chore) => chore.active)
            .map((chore) => (
              <p key={chore.id} className="row">
                {chore.title}
              </p>
            ))}
        </>
      ) : null}

      {screen === "approvals" && isParent && snapshot ? (
        <>
          <h1>Waiting on you</h1>
          {snapshot.chores
            .filter((item) => item.status === "pending")
            .map((item) => (
              <div key={item.id} className="row">
                <span>{item.title}</span>
                <span>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      await fetch(`/api/chores/instances/${item.id}/review`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "approve" }),
                      });
                      await loadAll();
                    }}
                  >
                    Approve
                  </button>
                </span>
              </div>
            ))}
          {requests
            .filter((item) => item.status === "pending")
            .map((item) => (
              <div key={item.id} className="row">
                <span>
                  {item.personName}: {item.rewardName}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await fetch(`/api/rewards/requests/${item.id}/review`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "approve" }),
                    });
                    await loadAll();
                  }}
                >
                  Approve
                </button>
              </div>
            ))}
        </>
      ) : null}

      {screen === "rewards" && isParent ? (
        <>
          <h1>Rewards</h1>
          <RewardForm
            onCreate={async (payload) => {
              await fetch("/api/rewards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
              await loadAll();
            }}
          />
          {rewards.map((reward) => (
            <p key={reward.id} className="row">
              {reward.name} · {reward.starCost}
            </p>
          ))}
        </>
      ) : null}

      {screen === "plan-meals" && isParent ? (
        <>
          <h1>Write dinners</h1>
          {week.map((iso) => (
            <label key={iso} className="field">
              <span>{iso}</span>
              <input
                className="input"
                defaultValue={snapshot?.meals.find((meal) => meal.date === iso)?.name ?? ""}
                list="meal-names"
                onFocus={async () => {
                  const res = await fetch("/api/meals/suggest");
                  const body = (await res.json()) as { names: string[] };
                  setSuggestions(body.names);
                }}
                onBlur={async (event) => {
                  await fetch("/api/meals", {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ date: iso, name: event.target.value }),
                  });
                }}
              />
            </label>
          ))}
          <datalist id="meal-names">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      ) : null}

      {screen === "add-device" && isParent ? <AddDevicePanel /> : null}

      {screen === "devices" && isParent ? <DevicesPanel /> : null}

      {screen === "pins" && isParent ? (
        <>
          <h1>Reset a PIN</h1>
          <PinForm
            people={snapshot?.people ?? []}
            onSave={async (personId, nextPin) => {
              const res = await fetch("/api/pins", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ personId, pin: nextPin }),
              });
              if (!res.ok) {
                const body = (await res.json()) as { error?: string };
                setError(body.error ?? "Could not save that PIN.");
                return;
              }
              setError("");
            }}
          />
          {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}
        </>
      ) : null}
      {tabs}
    </main>
  );
}

function ChoreForm({
  people,
  onCreate,
}: {
  people: Person[];
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [assignedPersonId, setAssignedPersonId] = useState(people[0]?.id ?? "");
  const [stars, setStars] = useState(1);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [repeatType, setRepeatType] = useState("daily");
  useEffect(() => {
    if (!assignedPersonId && people[0]) setAssignedPersonId(people[0].id);
  }, [assignedPersonId, people]);
  return (
    <form
      className="list"
      onSubmit={async (event) => {
        event.preventDefault();
        await onCreate({ title, assignedPersonId, stars, requiresPhoto, repeatType, weekdays: [1, 2, 3, 4, 5], weeklyWeekday: 0, onceDate: null });
        setTitle("");
      }}
    >
      <label className="field">
        <span>Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="field">
        <span>Kid</span>
        <select className="select" value={assignedPersonId} onChange={(e) => setAssignedPersonId(e.target.value)}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Stars</span>
        <input className="input" type="number" min={1} value={stars} onChange={(e) => setStars(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Photo?</span>
        <input type="checkbox" checked={requiresPhoto} onChange={(e) => setRequiresPhoto(e.target.checked)} />
      </label>
      <label className="field">
        <span>Repeat</span>
        <select className="select" value={repeatType} onChange={(e) => setRepeatType(e.target.value)}>
          <option value="daily">daily</option>
          <option value="weekdays">weekdays</option>
          <option value="weekly">weekly</option>
          <option value="once">one-time</option>
        </select>
      </label>
      <button className="btn" type="submit">
        Add chore
      </button>
    </form>
  );
}

function RewardForm({ onCreate }: { onCreate: (payload: { name: string; starCost: number }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [starCost, setStarCost] = useState(8);
  return (
    <form
      className="list"
      onSubmit={async (event) => {
        event.preventDefault();
        await onCreate({ name, starCost });
        setName("");
      }}
    >
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span>Stars</span>
        <input className="input" type="number" min={1} value={starCost} onChange={(e) => setStarCost(Number(e.target.value))} />
      </label>
      <button className="btn" type="submit">
        Add reward
      </button>
    </form>
  );
}

function PinForm({
  people,
  onSave,
}: {
  people: Person[];
  onSave: (personId: string, pin: string) => Promise<void>;
}) {
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [pin, setPin] = useState("");
  return (
    <form
      className="list"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(personId, pin);
        setPin("");
      }}
    >
      <label className="field">
        <span>Who</span>
        <select className="select" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>New PIN</span>
        <input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>
      <button className="btn" type="submit">
        Save PIN
      </button>
    </form>
  );
}
