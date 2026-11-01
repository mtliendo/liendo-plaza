import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { Person } from "@liendo/shared";
import { api } from "@/lib/api";
import { body, btn, btnLabel, colors, input, screen } from "@/lib/theme";

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
    <ScrollView contentContainerStyle={screen}>
      {people.map((person) => (
        <Pressable key={person.id} onPress={() => setPersonId(person.id)} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={{ fontWeight: person.id === personId ? "700" : "400", color: colors.ink }}>{person.name}</Text>
        </Pressable>
      ))}
      <TextInput value={pin} onChangeText={setPin} keyboardType="number-pad" placeholder="New PIN" style={input} />
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
        style={btn}
      >
        <Text style={btnLabel}>Save PIN</Text>
      </Pressable>
      {message ? <Text style={body}>{message}</Text> : null}
    </ScrollView>
  );
}
