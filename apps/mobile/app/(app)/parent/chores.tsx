import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { Link } from "expo-router";
import type { Chore, Person } from "@liendo/shared";
import { api } from "@/lib/api";

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
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Link href="/parent/approvals">Approvals</Link>
      <Link href="/parent/rewards">Rewards</Link>
      <Link href="/parent/meals">Plan dinners</Link>
      <Link href="/parent/pins">PINs</Link>
      <TextInput value={title} onChangeText={setTitle} placeholder="New chore" style={{ borderWidth: 1, padding: 12 }} />
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
        style={{ backgroundColor: "#C24A2A", padding: 14 }}
      >
        <Text style={{ color: "#FBF6EA", textAlign: "center" }}>Add chore</Text>
      </Pressable>
      {chores.filter((chore) => chore.active).map((chore) => (
        <Text key={chore.id}>{chore.title}</Text>
      ))}
    </ScrollView>
  );
}
