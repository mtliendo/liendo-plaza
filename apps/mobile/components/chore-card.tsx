import { Pressable, Text, View } from "react-native";
import type { ChoreInstance, Person } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { colors, type } from "@/lib/theme";

function statusLabel(status: ChoreInstance["status"]) {
  if (status === "done") return "Done";
  if (status === "pending") return "Waiting";
  if (status === "rejected") return "Try again";
  return "To do";
}

function Chip({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: colors.paper, paddingHorizontal: 8, paddingVertical: 5 }}>
      <Text style={{ color: colors.ink2, fontSize: 13, fontFamily: type.body }}>{label}</Text>
    </View>
  );
}

export function ChoreCard({
  chore,
  person,
  showPerson,
  onPress,
}: {
  chore: ChoreInstance;
  person?: Person;
  showPerson: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.paper2,
        padding: 16,
        minHeight: 64,
        gap: 8,
        opacity: chore.status === "done" ? 0.72 : 1,
      }}
    >
      {showPerson && person ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <PersonAvatar person={person} size={48} />
          <Text style={{ fontSize: 16, color: colors.ink, fontFamily: type.body }}>{person.name}</Text>
        </View>
      ) : null}
      <Text style={{ fontFamily: type.display, fontSize: 20, color: colors.ink }}>{chore.title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label={`${chore.status === "done" ? "✓ " : ""}${statusLabel(chore.status)}`} />
        {chore.requiresPhoto ? <Chip label="Needs a photo" /> : null}
        <Chip label={chore.stars === 1 ? "1 star" : `${chore.stars} stars`} />
      </View>
    </Pressable>
  );
}
