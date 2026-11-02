"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Person } from "@liendo/shared";
import { mealPhotoSrc, parseEventFixture, queryKeys, WEEKDAY_LABELS, weekDates } from "@liendo/shared";
import { EventBoard } from "@/components/EventBoard";
import { SoftLink } from "@/components/SoftLink";
import { AddDevicePanel, DevicesPanel } from "@/components/family/DevicePanels";
import { UnpairedFamily } from "@/components/family/UnpairedFamily";
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  useChoreReview,
  useChoreToggle,
  useHouseLists,
  useMe,
  useMealEdit,
  usePrefetchHouse,
  useRewardRequest,
  useRewardReview,
  useSnapshot,
  useSoftView,
} from "@/lib/query";

type Screen =
  | "gate"
  | "people"
  | "pin"
  | "today"
  | "calendar"
  | "meals"
  | "stars"
  | "manage"
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

const FAMILY_HREFS = {
  today: "/family",
  calendar: "/family/calendar",
  meals: "/family/meals",
  stars: "/family/stars",
  manage: "/family/manage",
  "manage-chores": "/family/chores",
  approvals: "/family/approvals",
  rewards: "/family/rewards",
  "plan-meals": "/family/plan",
  pins: "/family/pins",
  devices: "/family/devices",
  "add-device": "/family/add-device",
} as const;

function FamilyAppInner({ screen }: { screen: Exclude<Screen, "gate" | "people" | "pin"> }) {
  const params = useSearchParams();
  const invite = params.get("invite");
  const fixture = parseEventFixture(params.get("fixture"));
  const [board, go] = useSoftView(screen, FAMILY_HREFS);
  const [familyToken, setFamilyToken] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [phase, setPhase] = useState<Screen | "loading">("loading");
  const [pin, setPin] = useState("");
  const [picked, setPicked] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const meQuery = useMe();
  const signedIn = meQuery.data?.actor?.kind === "person";
  const snapshotQuery = useSnapshot(Boolean(signedIn));
  const lists = useHouseLists(Boolean(signedIn));
  const prefetch = usePrefetchHouse();
  const toggle = useChoreToggle();
  const choreReview = useChoreReview();
  const rewardReview = useRewardReview();
  const mealEdit = useMealEdit();
  const me = meQuery.data?.actor?.person ?? null;
  const askReward = useRewardRequest(me);
  const snapshot = snapshotQuery.data ?? null;
  const chores = lists.chores.data ?? [];
  const rewards = lists.rewards.data ?? [];
  const requests = lists.requests.data ?? [];

  const today = snapshot ? eventDay(snapshot.now) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);

  const headers = useMemo(() => {
    const next: Record<string, string> = { "content-type": "application/json" };
    if (familyToken) next["x-family-token"] = familyToken;
    return next;
  }, [familyToken]);

  useEffect(() => {
    if (signedIn) prefetch();
  }, [prefetch, signedIn]);

  useEffect(() => {
    if (meQuery.isPending && !meQuery.data) return;
    if (signedIn) {
      setPhase(board);
      return;
    }
    if (!familyToken) {
      setPhase("gate");
      return;
    }
    void (async () => {
      const peopleRes = await fetch("/api/people", { headers: { "x-family-token": familyToken } });
      if (peopleRes.ok) {
        const body = (await peopleRes.json()) as { people: Person[] };
        setPeople(body.people);
        setPhase("people");
      }
    })();
  }, [board, familyToken, meQuery.data, meQuery.isPending, signedIn]);

  const onPaired = useCallback((token: string | null) => {
    if (token) {
      setFamilyToken(token);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [queryClient]);

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
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    setPhase(screen);
  }

  const isParent = me?.role === "parent";
  const visibleChores =
    snapshot?.chores.filter((item) => (isParent ? true : item.personId === me?.id) && item.date === today) ?? [];
  const tonight = snapshot?.meals.find((meal) => meal.date === today);
  const pendingApprovals =
    (snapshot?.chores.filter((item) => item.status === "pending").length ?? 0) +
    requests.filter((item) => item.status === "pending").length;

  if (phase === "loading") {
    return (
      <main className="phone">
        <p className="small">Liendo Plaza</p>
        <p>Getting ready.</p>
      </main>
    );
  }

  if (phase === "gate") {
    return <UnpairedFamily invite={invite} onReady={onPaired} />;
  }

  if (phase === "people") {
    return (
      <main className="phone" data-testid="name-picker">
        <h1>Who are you?</h1>
        <div className="list">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              className="btn person-pick"
              style={{ ["--person" as string]: person.color }}
              onClick={() => {
                setPicked(person);
                setPhase("pin");
              }}
            >
              <PersonAvatar person={person} size={112} />
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
    <nav className={`tabs ${isParent ? "tabs-parent" : ""}`}>
      <SoftLink href="/family" current={board === "today"} onGo={() => go("today")} onPrefetch={prefetch}>
        Today
      </SoftLink>
      <SoftLink href="/family/calendar" current={board === "calendar"} onGo={() => go("calendar")} onPrefetch={prefetch}>
        Week
      </SoftLink>
      <SoftLink href="/family/meals" current={board === "meals"} onGo={() => go("meals")} onPrefetch={prefetch}>
        Dinner
      </SoftLink>
      <SoftLink href="/family/stars" current={board === "stars"} onGo={() => go("stars")} onPrefetch={prefetch}>
        Stars
      </SoftLink>
      {isParent ? (
        <SoftLink href="/family/manage" current={board === "manage"} onGo={() => go("manage")} onPrefetch={prefetch}>
          Manage
          {pendingApprovals > 0 ? <span className="tab-badge">{pendingApprovals}</span> : null}
        </SoftLink>
      ) : null}
    </nav>
  );

  return (
      <main className="phone">
        {me ? (
          <p className="small phone-who">
            <PersonAvatar person={me} size={40} />
            {me.name}
          </p>
        ) : null}
      {board === "today" ? (
        <>
          <h1>Today</h1>
          {snapshot ? (
            <EventBoard
              events={snapshot.events}
              now={snapshot.now}
              people={snapshot.people}
              maxVisible={5}
              moreHref={`/family/calendar${fixture ? `?fixture=${fixture}` : ""}`}
            />
          ) : null}
          {isParent && pendingApprovals > 0 ? (
            <SoftLink
              href="/family/approvals"
              className="approvals-chip tap"
              onGo={() => go("approvals")}
              onPrefetch={prefetch}
            >
              {pendingApprovals === 1 ? "1 waiting" : `${pendingApprovals} waiting`}
            </SoftLink>
          ) : null}
          <aside className="today-dinner">
            <p className="place">Tonight’s dinner</p>
            <p className="dinner-name">{tonight?.name ?? "Nothing written yet"}</p>
          </aside>
          <div className="list">
            {visibleChores.map((chore) => {
              const person = snapshot?.people.find((row) => row.id === chore.personId);
              return (
                <button
                  key={chore.id}
                  type="button"
                  className="chore-btn"
                  style={{
                    ["--person" as string]: person?.color ?? "var(--color-accent)",
                  }}
                  onClick={async () => {
                    if (chore.requiresPhoto && chore.status === "open") return;
                    if (chore.status !== "open" && chore.status !== "done") return;
                    toggle.mutate({ id: chore.id, undo: chore.status === "done" });
                  }}
                >
                  {person && isParent ? (
                    <span className="name-line">
                      <PersonAvatar person={person} size={48} />
                      {person.name}
                    </span>
                  ) : null}
                  {chore.title}
                  <span className="small">{chore.status}</span>
                  {chore.requiresPhoto ? <span className="small">photo</span> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {board === "manage" && isParent ? (
        <>
          <h1>Manage</h1>
          <div className="parent-links">
            <SoftLink href="/family/approvals" onGo={() => go("approvals")} onPrefetch={prefetch}>
              Approvals
              {pendingApprovals > 0 ? ` (${pendingApprovals})` : ""}
            </SoftLink>
            <SoftLink href="/family/chores" onGo={() => go("manage-chores")} onPrefetch={prefetch}>
              Edit chores
            </SoftLink>
            <SoftLink href="/family/rewards" onGo={() => go("rewards")} onPrefetch={prefetch}>
              Rewards
            </SoftLink>
            <SoftLink href="/family/plan" onGo={() => go("plan-meals")} onPrefetch={prefetch}>
              Plan dinners
            </SoftLink>
            <SoftLink href="/family/add-device" onGo={() => go("add-device")} onPrefetch={prefetch}>
              Add a device
            </SoftLink>
            <SoftLink href="/family/devices" onGo={() => go("devices")} onPrefetch={prefetch}>
              Devices
            </SoftLink>
            <SoftLink href="/family/pins" onGo={() => go("pins")} onPrefetch={prefetch}>
              PINs
            </SoftLink>
          </div>
        </>
      ) : null}

      {board === "calendar" && snapshot ? (
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

      {board === "meals" && snapshot ? (
        <>
          <h1>Dinners</h1>
          {week.map((iso) => {
            const meal = snapshot.meals.find((row) => row.date === iso);
            const thumb = mealPhotoSrc(meal?.photoPath);
            return (
              <p key={iso} className="row">
                <span className="day-name">{iso.slice(5)}</span>
                <span className="meal-line">
                  {thumb ? <img src={thumb} alt="" className="meal-thumb" /> : null}
                  <span>{meal?.name ?? "—"}</span>
                </span>
              </p>
            );
          })}
        </>
      ) : null}

      {board === "stars" && snapshot ? (
        <>
          <h1>Stars</h1>
          {snapshot.stars.map((row) => {
            const person = snapshot.people.find((item) => item.id === row.personId);
            return (
              <p key={row.personId} className="row person-row" style={{ ["--person" as string]: row.color }}>
                <span className="name-line">
                  {person ? <PersonAvatar person={person} size={56} /> : null}
                  {row.personName}
                </span>
                <span className="small">
                  {row.balance} to spend
                  <br />
                  {row.weekEarned} this week
                </span>
              </p>
            );
          })}
          <h2>Ask for a reward</h2>
          {rewards
            .filter((reward) => reward.active)
            .map((reward) => (
              <button
                key={reward.id}
                type="button"
                className="chore-btn"
                onClick={async () => {
                  askReward.mutate(reward.id);
                }}
              >
                {reward.name}
                <span className="small">{reward.starCost} stars</span>
              </button>
            ))}
        </>
      ) : null}

      {board === "manage-chores" && isParent ? (
        <>
          <h1>Chores</h1>
          <ChoreForm
            people={snapshot?.people.filter((p) => p.role === "kid") ?? []}
            onCreate={async (payload) => {
              await fetch("/api/chores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
              await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
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

      {board === "approvals" && isParent && snapshot ? (
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
                      choreReview.mutate({ id: item.id, action: "approve" });
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
                <span className="name-line">
                  {snapshot.people
                    .filter((person) => person.id === item.personId)
                    .map((person) => (
                      <PersonAvatar key={person.id} person={person} size={48} />
                    ))}
                  {item.personName}: {item.rewardName}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    rewardReview.mutate({ id: item.id, action: "approve" });
                  }}
                >
                  Approve
                </button>
              </div>
            ))}
        </>
      ) : null}

      {board === "rewards" && isParent ? (
        <>
          <h1>Rewards</h1>
          <RewardForm
            onCreate={async (payload) => {
              await fetch("/api/rewards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
              await queryClient.invalidateQueries({ queryKey: queryKeys.rewards });
            }}
          />
          {rewards.map((reward) => (
            <p key={reward.id} className="row">
              {reward.name} {reward.starCost}
            </p>
          ))}
        </>
      ) : null}

      {board === "plan-meals" && isParent ? (
        <>
          <h1>Write dinners</h1>
          {week.map((iso) => {
            const meal = snapshot?.meals.find((row) => row.date === iso);
            const thumb = mealPhotoSrc(meal?.photoPath);
            return (
              <label key={iso} className="field">
                <span className="day-name">{iso}</span>
                <input
                  className="input"
                  defaultValue={meal?.name ?? ""}
                  list="meal-names"
                  onFocus={async () => {
                    const res = await fetch("/api/meals/suggest");
                    const body = (await res.json()) as { names: string[] };
                    setSuggestions(body.names);
                  }}
                  onBlur={async (event) => {
                    mealEdit.mutate({ date: iso, name: event.target.value });
                  }}
                />
                <span className="meal-line">
                  {thumb ? <img src={thumb} alt="" className="meal-thumb" /> : null}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const form = new FormData();
                      form.append("photo", file);
                      await fetch(`/api/meals/${iso}/photo`, { method: "POST", body: form });
                      await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
                    }}
                  />
                </span>
              </label>
            );
          })}
          <datalist id="meal-names">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      ) : null}

      {board === "add-device" && isParent ? <AddDevicePanel /> : null}

      {board === "devices" && isParent ? <DevicesPanel /> : null}

      {board === "pins" && isParent ? (
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
