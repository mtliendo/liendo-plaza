import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import type { Chore, Person, RepeatType } from "@liendo/shared";
import { WEEKDAY_LABELS, repeatLabel } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { api } from "@/lib/api";
import { useMe } from "@/lib/query";
import { body, btn, btnLabel, colors, input, muted, screen, type } from "@/lib/theme";

type Draft = {
  title: string;
  assignedPersonId: string;
  stars: string;
  requiresPhoto: boolean;
  repeatType: RepeatType;
  weekdays: number[];
  onceDate: string;
};

const EMPTY: Draft = {
  title: "",
  assignedPersonId: "",
  stars: "1",
  requiresPhoto: false,
  repeatType: "daily",
  weekdays: [1, 2, 3, 4, 5],
  onceDate: "",
};

function payload(draft: Draft) {
  return {
    title: draft.title,
    assignedPersonId: draft.assignedPersonId,
    stars: Number(draft.stars) || 1,
    requiresPhoto: draft.requiresPhoto,
    repeatType: draft.repeatType,
    weekdays: draft.repeatType === "weekly" ? draft.weekdays : draft.repeatType === "weekdays" ? [1, 2, 3, 4, 5] : null,
    weeklyWeekday: draft.repeatType === "weekly" ? (draft.weekdays[0] ?? 0) : null,
    onceDate: draft.repeatType === "once" ? draft.onceDate || null : null,
  };
}

export default function ParentChoresScreen() {
  const me = useMe().data?.actor.person ?? null;
  const isParent = me?.role === "parent";
  const [chores, setChores] = useState<Chore[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function load() {
    const nextChores = ((await api("chores")) as { chores: Chore[] }).chores;
    const nextPeople = ((await api("people")) as { people: Person[] }).people.filter((p) => p.role === "kid");
    setChores(nextChores);
    setPeople(nextPeople);
    setDraft((current) => ({ ...current, assignedPersonId: current.assignedPersonId || nextPeople[0]?.id || "" }));
  }

  useEffect(() => {
    void load();
  }, []);

  if (!isParent) {
    return (
      <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic">
        <Text style={body}>Ask a parent if you need to change chores or dinner.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Pressable
        testID="refresh-frame"
        onPress={async () => {
          try {
            await api("display/refresh", { method: "POST" });
            setNote("Frame will refresh in a moment");
          } catch {
            setNote("Could not reach the kitchen frame.");
          }
        }}
        style={{ backgroundColor: colors.paper2, padding: 16, minHeight: 64, justifyContent: "center" }}
      >
        <Text style={{ fontSize: 18, color: colors.ink }}>Refresh kitchen frame</Text>
      </Pressable>
      {note ? <Text style={muted}>{note}</Text> : null}
      <Link href="/parent/approvals">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>Approvals</Text>
      </Link>
      <Link href="/parent/rewards">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>Rewards</Text>
      </Link>
      <Link href="/parent/pins">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>PINs</Text>
      </Link>
      <Text style={{ fontFamily: type.display, fontSize: 22, color: colors.ink }}>
        {editingId ? "Edit chore" : "New chore"}
      </Text>
      <TextInput value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} placeholder="Chore name" style={input} />
      <View style={{ gap: 8 }}>
        <Text style={muted}>Who</Text>
        {people.map((person) => (
          <Pressable
            key={person.id}
            onPress={() => setDraft({ ...draft, assignedPersonId: person.id })}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 48,
              backgroundColor: draft.assignedPersonId === person.id ? colors.paper3 : colors.paper2,
              padding: 12,
            }}
          >
            <PersonAvatar person={person} size={36} />
            <Text style={body}>{person.name}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={draft.stars}
        onChangeText={(stars) => setDraft({ ...draft, stars })}
        keyboardType="number-pad"
        placeholder="Stars"
        style={input}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={body}>Needs a photo</Text>
        <Switch value={draft.requiresPhoto} onValueChange={(requiresPhoto) => setDraft({ ...draft, requiresPhoto })} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={muted}>Repeat</Text>
        {([
          ["daily", "Every day"],
          ["weekdays", "Weekdays"],
          ["weekly", "On chosen days"],
          ["once", "Once"],
        ] as const).map(([value, label]) => (
          <Pressable key={value} onPress={() => setDraft({ ...draft, repeatType: value })} style={{ minHeight: 44 }}>
            <Text style={{ color: draft.repeatType === value ? colors.accent : colors.ink, fontSize: 16 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {draft.repeatType === "weekly" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {WEEKDAY_LABELS.map((label, index) => {
            const on = draft.weekdays.includes(index);
            return (
              <Pressable
                key={label}
                onPress={() => {
                  const weekdays = on ? draft.weekdays.filter((day) => day !== index) : [...draft.weekdays, index].sort((a, b) => a - b);
                  setDraft({ ...draft, weekdays });
                }}
                style={{ padding: 10, backgroundColor: on ? colors.paper3 : colors.paper2, minWidth: 48, alignItems: "center" }}
              >
                <Text style={body}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {draft.repeatType === "once" ? (
        <TextInput value={draft.onceDate} onChangeText={(onceDate) => setDraft({ ...draft, onceDate })} placeholder="YYYY-MM-DD" style={input} />
      ) : null}
      <Pressable
        onPress={async () => {
          if (!draft.title || !draft.assignedPersonId) return;
          if (editingId) {
            await api(`chores/${editingId}`, { method: "PATCH", body: JSON.stringify(payload(draft)) });
          } else {
            await api("chores", { method: "POST", body: JSON.stringify(payload(draft)) });
          }
          setDraft({ ...EMPTY, assignedPersonId: people[0]?.id ?? "" });
          setEditingId(null);
          await load();
        }}
        style={btn}
      >
        <Text style={btnLabel}>{editingId ? "Save chore" : "Add chore"}</Text>
      </Pressable>
      {editingId ? (
        <Pressable
          onPress={() => {
            setEditingId(null);
            setDraft({ ...EMPTY, assignedPersonId: people[0]?.id ?? "" });
          }}
        >
          <Text style={muted}>Cancel</Text>
        </Pressable>
      ) : null}
      {chores
        .filter((chore) => chore.active)
        .map((chore) => {
          const person = people.find((row) => row.id === chore.assignedPersonId);
          return (
            <View key={chore.id} style={{ backgroundColor: colors.paper2, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {person ? <PersonAvatar person={person} size={40} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={body}>
                    {person ? `${person.name} · ` : ""}
                    {chore.title}
                  </Text>
                  <Text style={muted}>
                    {repeatLabel(chore)} · {chore.stars === 1 ? "1 star" : `${chore.stars} stars`}
                    {chore.requiresPhoto ? " · photo" : ""}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <Pressable
                  onPress={() => {
                    setEditingId(chore.id);
                    setDraft({
                      title: chore.title,
                      assignedPersonId: chore.assignedPersonId,
                      stars: String(chore.stars),
                      requiresPhoto: chore.requiresPhoto,
                      repeatType: chore.repeatType,
                      weekdays: chore.weekdays ?? (chore.weeklyWeekday != null ? [chore.weeklyWeekday] : []),
                      onceDate: chore.onceDate ?? "",
                    });
                  }}
                >
                  <Text style={{ color: colors.accent }}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await api(`chores/${chore.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Text style={{ color: colors.error }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
    </ScrollView>
  );
}
