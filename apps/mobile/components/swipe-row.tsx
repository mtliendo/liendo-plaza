import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import * as Haptics from "expo-haptics";
import { colors, type } from "@/lib/theme";

function Action({
  label,
  background,
  onPress,
}: {
  label: string;
  background: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: background,
        minWidth: 88,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 16,
        borderCurve: "continuous",
      }}
    >
      <Text style={{ color: colors.accentInk, fontFamily: type.body, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function SwipeRow({
  children,
  enabled,
  onEdit,
  onDelete,
}: {
  children: React.ReactNode;
  enabled: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const ref = useRef<SwipeableMethods>(null);
  if (!enabled || (!onEdit && !onDelete)) return <>{children}</>;

  function closeThen(action?: () => void) {
    ref.current?.close();
    action?.();
  }

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      leftThreshold={40}
      overshootRight={false}
      overshootLeft={false}
      onSwipeableWillOpen={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
      renderLeftActions={
        onEdit
          ? () => <Action label="Edit" background={colors.accent} onPress={() => closeThen(onEdit)} />
          : undefined
      }
      renderRightActions={() => (
        <View style={{ flexDirection: "row" }}>
          {onEdit ? <Action label="Edit" background={colors.accent} onPress={() => closeThen(onEdit)} /> : null}
          {onDelete ? <Action label="Delete" background={colors.error} onPress={() => closeThen(onDelete)} /> : null}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
