import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { mealPhotoSrc, weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { getSession } from "@/lib/session";
import { accentLabel, input, muted, screen } from "@/lib/theme";

export default function ParentMealsScreen() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);
  const [names, setNames] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  async function load() {
    const body = (await api(`meals?from=${week[0]}&to=${week[6]}`)) as {
      meals: { date: string; name: string; photoPath: string | null }[];
    };
    setNames(Object.fromEntries(body.meals.map((meal) => [meal.date, meal.name])));
    setPhotos(Object.fromEntries(body.meals.map((meal) => [meal.date, meal.photoPath])));
  }
  useEffect(() => {
    void load();
  }, [week]);

  async function sendPhoto(date: string) {
    const shot = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false });
    if (shot.canceled || !shot.assets[0]) return;
    const token = await getSession();
    const form = new FormData();
    form.append("photo", {
      uri: shot.assets[0].uri,
      name: "meal.jpg",
      type: "image/jpeg",
    } as never);
    await fetch(`${API_URL}/api/meals/${date}/photo`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    await load();
  }

  return (
    <ScrollView contentContainerStyle={screen}>
      {week.map((iso) => {
        const thumb = mealPhotoSrc(photos[iso]);
        const uri = thumb?.startsWith("http") ? thumb : thumb ? `${API_URL}${thumb}` : null;
        return (
          <View key={iso} style={{ gap: 8 }}>
            <Text style={accentLabel}>{iso}</Text>
            <TextInput
              value={names[iso] ?? ""}
              placeholder={iso}
              onChangeText={(value) => setNames((current) => ({ ...current, [iso]: value }))}
              onEndEditing={() => {
                void api("meals", { method: "PUT", body: JSON.stringify({ date: iso, name: names[iso] ?? "" }) });
              }}
              style={input}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {uri ? <Image source={{ uri }} style={{ width: 56, height: 56 }} /> : null}
              <Pressable onPress={() => void sendPhoto(iso)}>
                <Text style={muted}>{uri ? "Replace photo" : "Add a photo"}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <Text style={muted}>Type a dinner. Names you have used before will match on the web planner.</Text>
    </ScrollView>
  );
}
