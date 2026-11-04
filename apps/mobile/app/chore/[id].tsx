import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { repeatLabel } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { API_URL } from "@/lib/config";
import { photoUri } from "@/lib/api";
import { useChoreToggle, useMe, useSnapshot } from "@/lib/query";
import { getSession } from "@/lib/session";
import { body, btn, btnLabel, colors, curve, h2, muted, screen, type } from "@/lib/theme";

function statusCopy(status: string) {
  if (status === "done") return "Done today";
  if (status === "pending") return "Waiting on a parent";
  if (status === "rejected") return "Try again";
  return "Still open";
}


export default function ChoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const me = useMe().data?.actor.person ?? null;
  const snapshotQuery = useSnapshot();
  const toggle = useChoreToggle();
  const snapshot = snapshotQuery.data ?? null;
  const chore = snapshot?.chores.find((item) => item.id === id);
  const person = snapshot?.people.find((row) => row.id === chore?.personId);
  const canAct = Boolean(chore && (me?.role === "parent" || me?.id === chore.personId));

  async function sendPhoto() {
    if (!chore) return;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (shot.canceled || !shot.assets[0]) return;
    const token = await getSession();
    const form = new FormData();
    form.append("photo", {
      uri: shot.assets[0].uri,
      name: "chore.jpg",
      type: "image/jpeg",
    } as never);
    await fetch(`${API_URL}/api/chores/instances/${chore.id}/photo`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    await snapshotQuery.refetch();
    router.back();
  }

  if (!chore) {
    return (
      <ScrollView contentContainerStyle={screen}>
        <Text style={body}>That chore is not on today’s list.</Text>
      </ScrollView>
    );
  }

  const open = chore.status === "open" || chore.status === "rejected";
  const guide = photoUri(chore.guidePhotoPath);
  const proof = photoUri(chore.photoPath);

  return (
    <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic">
      {person ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <PersonAvatar person={person} size={56} />
          <Text style={body}>{person.name}</Text>
        </View>
      ) : null}
      <Text style={h2}>{chore.title}</Text>
      <Text style={muted}>
        {statusCopy(chore.status)} · {chore.stars === 1 ? "1 star" : `${chore.stars} stars`} · {repeatLabel(chore)}
        {chore.requiresPhoto ? " · Needs a photo" : ""}
      </Text>
      {chore.description ? <Text style={body}>{chore.description}</Text> : null}
      {guide ? <Image source={{ uri: guide }} style={{ width: "100%", height: 220, ...curve.card }} /> : null}
      {chore.steps.map((step, index) => (
        <Text key={step} style={body}>
          {index + 1}. {step}
        </Text>
      ))}
      {proof ? <Image source={{ uri: proof }} style={{ width: "100%", height: 220, ...curve.card }} /> : null}
      {canAct && open && !chore.requiresPhoto ? (
        <Pressable
          style={btn}
          onPress={() => {
            toggle.mutate({ id: chore.id });
            router.back();
          }}
        >
          <Text style={btnLabel}>Mark done</Text>
        </Pressable>
      ) : null}
      {canAct && open && chore.requiresPhoto ? (
        <Pressable style={btn} onPress={() => void sendPhoto()}>
          <Text style={btnLabel}>Take a photo</Text>
        </Pressable>
      ) : null}
      {canAct && chore.status === "done" ? (
        <Pressable
          onPress={() => {
            toggle.mutate({ id: chore.id, undo: true });
            router.back();
          }}
        >
          <Text style={{ color: colors.accent, fontFamily: type.body, fontSize: 16 }}>Not done</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
