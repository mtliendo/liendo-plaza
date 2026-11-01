import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { Person } from "@liendo/shared";
import { api } from "@/lib/api";

export default function PinsScreen() {
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    void (async () => {
      const body = (await api("people")) as { people: Person[] };
      setPeople(body.people);
      setPersonId(body.people[0]?.id ?? "");
    })();
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      {people.map((person) => (
        <Pressable key={person.id} onPress={() => setPersonId(person.id)}>
          <Text style={{ fontWeight: person.id === personId ? "700" : "400" }}>{person.name}</Text>
        </Pressable>
      ))}
      <TextInput value={pin} onChangeText={setPin} keyboardType="number-pad" placeholder="New PIN" style={{ borderWidth: 1, padding: 12 }} />
      <Pressable
        onPress={async () => {
          try {
            await api("pins", { method: "POST", body: JSON.stringify({ personId, pin }) });
            setMessage("PIN saved.");
            setPin("");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not save that PIN.");
          }
        }}
        style={{ backgroundColor: "#C24A2A", padding: 14 }}
      >
        <Text style={{ color: "#FBF6EA", textAlign: "center" }}>Save PIN</Text>
      </Pressable>
      {message ? <Text>{message}</Text> : null}
    </ScrollView>
  );
}
