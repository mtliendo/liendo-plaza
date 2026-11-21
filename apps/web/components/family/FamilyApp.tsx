"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { mealPhotoSrc, parseEventFixture, queryKeys, weekDates } from "@liendo/shared";
import { EventBoard } from "@/components/EventBoard";
import { SoftLink } from "@/components/SoftLink";
import { ChoreCard } from "@/components/family/ChoreCard";
import { ChoreDetail } from "@/components/family/ChoreDetail";
import { ChoreManage } from "@/components/family/ChoreManage";
import { DinnerList } from "@/components/family/DinnerList";
import { AddDevicePanel, DevicesPanel } from "@/components/family/DevicePanels";
import { FamilyCodeGate, FamilyCodeSettings } from "@/components/family/FamilyCodes";
import { WeekGlance } from "@/components/family/WeekGlance";
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  useChoreReview,
  useChoreToggle,
  useHouseLists,
  useMe,
  useMealEdit,
  usePrefetchHouse,
  useRequestFrameRefresh,
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
  pins: "/family/pins",
  devices: "/family/devices",
  "add-device": "/family/add-device",
} as const;

function FamilyAppInner({ screen }: { screen: Exclude<Screen, "gate" | "people" | "pin"> }) {
  const params = useSearchParams();
  const fixture = parseEventFixture(params.get("fixture"));
  const [board, go] = useSoftView(screen, FAMILY_HREFS);
  const [phase, setPhase] = useState<Screen | "loading">("loading");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [openChoreId, setOpenChoreId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const meQuery = useMe();
  const signedIn = meQuery.data?.actor?.kind === "person";
  const codeStatus = useQuery({
    queryKey: ["family-code-status"], enabled: signedIn,
    queryFn: async () => {
      const response = await fetch("/api/auth/codes/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not check family codes.");
      return response.json() as Promise<{ setupRequired: boolean }>;
    },
  });
  const snapshotQuery = useSnapshot(Boolean(signedIn));
  const lists = useHouseLists(Boolean(signedIn));
  const prefetch = usePrefetchHouse();
  const toggle = useChoreToggle();
  const choreReview = useChoreReview();
  const rewardReview = useRewardReview();
  const mealEdit = useMealEdit();
  const refreshFrame = useRequestFrameRefresh();
  const me = meQuery.data?.actor?.person ?? null;
  const askReward = useRewardRequest(me);
  const snapshot = snapshotQuery.data ?? null;
  const chores = lists.chores.data ?? [];
  const rewards = lists.rewards.data ?? [];
  const requests = lists.requests.data ?? [];

  const today = snapshot ? eventDay(snapshot.now) : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);
  const openChore = snapshot?.chores.find((item) => item.id === openChoreId) ?? null;

  useEffect(() => {
    if (signedIn) prefetch();
  }, [prefetch, signedIn]);

  useEffect(() => {
    if (meQuery.isPending && !meQuery.data) return;
    if (signedIn && !codeStatus.data?.setupRequired) {
      setPhase(board);
      return;
    }
    setPhase("gate");
  }, [board, codeStatus.data?.setupRequired, meQuery.data, meQuery.isPending, signedIn]);

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
    return <FamilyCodeGate onReady={async () => {
      setPhase("loading");
      setOpenChoreId(null);
      setSuggestions([]);
      await queryClient.cancelQueries();
      await queryClient.resetQueries();
    }} />;
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
                <ChoreCard
                  key={chore.id}
                  chore={chore}
                  person={person}
                  showPerson={Boolean(isParent && person)}
                  onPress={() => setOpenChoreId(chore.id)}
                />
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
            <SoftLink href="/family/add-device" onGo={() => go("add-device")} onPrefetch={prefetch}>
              Add a device
            </SoftLink>
            <SoftLink href="/family/devices" onGo={() => go("devices")} onPrefetch={prefetch}>
              Devices
            </SoftLink>
            <SoftLink href="/family/pins" onGo={() => go("pins")} onPrefetch={prefetch}>
              Family codes
            </SoftLink>
            <button
              type="button"
              className="parent-action"
              data-testid="refresh-frame"
              onClick={() => refreshFrame.mutate()}
              disabled={refreshFrame.isPending}
            >
              Refresh kitchen frame
            </button>
          </div>
        </>
      ) : null}

      {board === "calendar" && snapshot ? (
        <>
          <h1>This week at a glance</h1>
          <WeekGlance
            week={week}
            today={today}
            events={snapshot.events}
            chores={snapshot.chores}
            meals={snapshot.meals}
            people={snapshot.people}
          />
        </>
      ) : null}

      {board === "meals" && snapshot ? (
        <>
          <h1>Dinner</h1>
          <DinnerList
            week={week}
            today={today}
            meals={snapshot.meals}
            isParent={isParent}
            suggestions={suggestions}
            onSuggest={async () => {
              const res = await fetch("/api/meals/suggest");
              const body = (await res.json()) as { names: string[] };
              setSuggestions(body.names);
            }}
            onSave={(date, name) => mealEdit.mutate({ date, name })}
            onPhoto={async (date, file) => {
              const form = new FormData();
              form.append("photo", file);
              await fetch(`/api/meals/${date}/photo`, { method: "POST", body: form });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            }}
            onClearPhoto={async (date) => {
              await fetch(`/api/meals/${date}/photo`, { method: "DELETE" });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            }}
          />
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

      {board === "manage-chores" && !isParent ? (
        <>
          <h1>Chores</h1>
          <p>Ask a parent if you need to change the chore list.</p>
        </>
      ) : null}

      {board === "manage-chores" && isParent ? (
        <>
          <h1>Chores</h1>
          <p className="small">Add, change, or take a chore off the board. Kids see the change on Today and the kitchen frame.</p>
          <ChoreManage
            people={snapshot?.people.filter((p) => p.role === "kid") ?? []}
            chores={chores}
            onCreate={async (payload) => {
              const res = await fetch("/api/chores", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              });
              const body = (await res.json()) as { chore?: { id: string } };
              await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
              return body.chore?.id;
            }}
            onUpdate={async (id, payload) => {
              await fetch(`/api/chores/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
              await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            }}
            onDelete={async (id) => {
              await fetch(`/api/chores/${id}`, { method: "DELETE" });
              await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            }}
            onGuidePhoto={async (id, file) => {
              const form = new FormData();
              form.append("photo", file);
              await fetch(`/api/chores/${id}/guide-photo`, { method: "POST", body: form });
              await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            }}
            onClearGuide={async (id) => {
              await fetch(`/api/chores/${id}/guide-photo`, { method: "DELETE" });
              await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
              await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            }}
          />
        </>
      ) : null}

      {board === "approvals" && isParent && snapshot ? (
        <>
          <h1>Waiting on you</h1>
          {snapshot.chores
            .filter((item) => item.status === "pending")
            .map((item) => {
              const proof = mealPhotoSrc(item.photoPath);
              const person = snapshot.people.find((candidate) => candidate.id === item.personId);
              return (
                <div key={item.id} className="row approval-row" data-testid={`approval-${item.id}`}>
                  <span className="approval-proof">
                    <span className="name-line">
                      {person ? <PersonAvatar person={person} size={48} /> : null}
                      {person ? `${person.name}: ` : ""}{item.title}
                    </span>
                    {proof ? <img src={proof} alt={`Proof photo for ${item.title}`} className="chore-guide-photo" /> : null}
                  </span>
                  <span className="approval-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        choreReview.mutate({ id: item.id, action: "approve" });
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        choreReview.mutate({ id: item.id, action: "reject" });
                      }}
                    >
                      Send back
                    </button>
                  </span>
                </div>
              );
            })}
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

      {board === "add-device" && isParent ? <AddDevicePanel /> : null}

      {board === "devices" && isParent ? <DevicesPanel /> : null}

      {board === "pins" && isParent ? (
        <FamilyCodeSettings people={snapshot?.people ?? []} />
      ) : null}
      {tabs}
      {openChore && snapshot ? (
        <ChoreDetail
          chore={openChore}
          person={snapshot.people.find((row) => row.id === openChore.personId)}
          canAct={Boolean(isParent || me?.id === openChore.personId)}
          onClose={() => setOpenChoreId(null)}
          onComplete={() => {
            toggle.mutate({ id: openChore.id });
            setOpenChoreId(null);
          }}
          onUndo={() => {
            toggle.mutate({ id: openChore.id, undo: true });
            setOpenChoreId(null);
          }}
          onPhoto={async (file) => {
            const form = new FormData();
            form.append("photo", file);
            await fetch(`/api/chores/instances/${openChore.id}/photo`, { method: "POST", body: form });
            await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
            setOpenChoreId(null);
          }}
        />
      ) : null}
    </main>
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
