import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, curve, type } from "@/lib/theme";

export function UndoToast({
  message,
  onUndo,
  onGone,
}: {
  message: string;
  onUndo: () => void;
  onGone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onGone, 4000);
    return () => clearTimeout(timer);
  }, [onGone]);

  return (
    <View
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 24,
        backgroundColor: colors.ink,
        padding: 16,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        ...curve.card,
      }}
    >
      <Text style={{ color: colors.paper, fontFamily: type.body, flex: 1 }}>{message}</Text>
      <Pressable onPress={onUndo}>
        <Text style={{ color: colors.paper, fontFamily: type.body, fontSize: 16 }}>Undo</Text>
      </Pressable>
    </View>
  );
}
