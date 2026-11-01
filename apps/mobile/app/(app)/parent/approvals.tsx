import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import type { DisplaySnapshot, RewardRequest } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { colors, row, screen } from "@/lib/theme";

export default function ApprovalsScreen() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [requests, setRequests] = useState<RewardRequest[]>([]);
  const load = useCallback(async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const week = weekDates(today);
    setSnapshot((await api(`snapshot?from=${week[0]}&to=${week[6]}`)) as DisplaySnapshot);
    setRequests(((await api("rewards/requests")) as { requests: RewardRequest[] }).requests);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ScrollView contentContainerStyle={screen}>
      {snapshot?.chores
        .filter((item) => item.status === "pending")
        .map((item) => (
          <Pressable
            key={item.id}
            onPress={async () => {
              await api(`chores/instances/${item.id}/review`, {
                method: "POST",
                body: JSON.stringify({ action: "approve" }),
              });
              await load();
            }}
            style={row}
          >
            <Text style={{ color: colors.ink }}>Approve {item.title}</Text>
          </Pressable>
        ))}
      {requests
        .filter((item) => item.status === "pending")
        .map((item) => (
          <Pressable
            key={item.id}
            onPress={async () => {
              await api(`rewards/requests/${item.id}/review`, {
                method: "POST",
                body: JSON.stringify({ action: "approve" }),
              });
              await load();
            }}
            style={row}
          >
            <Text style={{ color: colors.ink }}>
              Approve {item.rewardName} for {item.personName}
            </Text>
          </Pressable>
        ))}
    </ScrollView>
  );
}
