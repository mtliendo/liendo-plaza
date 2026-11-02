import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import type { DisplaySnapshot } from "@liendo/shared";
import { mealPhotoSrc, weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { accentLabel, body, colors, h1, screen, type } from "@/lib/theme";
import { API_URL } from "@/lib/config";

export default function MealsScreen() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  useEffect(() => {
    void (async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const week = weekDates(today);
      setSnapshot((await api(`snapshot?from=${week[0]}&to=${week[6]}`)) as DisplaySnapshot);
    })();
  }, []);
  const week = weekDates(snapshot?.now.slice(0, 10) ?? "");
  return (
    <ScrollView contentContainerStyle={screen}>
      <Text style={h1}>Dinner</Text>
      {week.map((iso) => {
        const meal = snapshot?.meals.find((row) => row.date === iso);
        const thumb = mealPhotoSrc(meal?.photoPath);
        const uri = thumb?.startsWith("http") ? thumb : thumb ? `${API_URL}${thumb}` : null;
        return (
          <View key={iso} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <Text style={accentLabel}>{iso.slice(5)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {uri ? <Image source={{ uri }} style={{ width: 48, height: 48 }} /> : null}
              <Text style={{ fontFamily: type.display, fontSize: 20, color: colors.ink }}>{meal?.name ?? "—"}</Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
