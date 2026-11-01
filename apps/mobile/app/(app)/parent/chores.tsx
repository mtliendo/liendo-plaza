import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import type { Chore, Person } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { api } from "@/lib/api";
import { body, btn, btnLabel, colors, input, screen } from "@/lib/theme";

export default function ParentChoresScreen() {
  const [chores, setChores] = useState<Chore[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  useEffect(() => {
    void (async () => {
      setChores(((await api("chores")) as { chores: Chore[] }).chores);
      setPeople(((await api("people")) as { people: Person[] }).people.filter((p) => p.role === "kid"));
    })();
  }, []);
  const kid = people[0];
  return (
    <ScrollView contentContainerStyle={screen}>
      <Link href="/parent/approvals">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>Approvals</Text>
      </Link>
      <Link href="/parent/rewards">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>Rewards</Text>
      </Link>
      <Link href="/parent/meals">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>Plan dinners</Text>
      </Link>
      <Link href="/parent/pins">
        <Text style={{ color: colors.accent, minHeight: 48, fontSize: 18 }}>PINs</Text>
      </Link>
      <TextInput value={title} onChangeText={setTitle} placeholder="New chore" style={input} />
      <Pressable
        onPress={async () => {
          if (!kid || !title) return;
          await api("chores", {
            method: "POST",
            body: JSON.stringify({
              title,
              assignedPersonId: kid.id,
              stars: 1,
              requiresPhoto: false,
              repeatType: "daily",
            }),
          });
          setTitle("");
          setChores(((await api("chores")) as { chores: Chore[] }).chores);
        }}
        style={btn}
      >
        <Text style={btnLabel}>Add chore</Text>
      </Pressable>
      {chores
        .filter((chore) => chore.active)
        .map((chore) => {
          const person = people.find((row) => row.id === chore.assignedPersonId);
          return (
            <View key={chore.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {person ? <PersonAvatar person={person} size={40} /> : null}
              <Text style={body}>
                {person ? `${person.name} · ` : ""}
                {chore.title}
              </Text>
            </View>
          );
        })}
    </ScrollView>
  );
}
