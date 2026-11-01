import { Image, Text, View } from "react-native";
import { isKidAvatarKey } from "@liendo/shared";
import { colors, type } from "@/lib/theme";

const KID_AVATARS = {
  sofia: require("../assets/avatars/sofia.webp"),
  noah: require("../assets/avatars/noah.webp"),
  xavier: require("../assets/avatars/xavier.webp"),
} as const;

export type AvatarPerson = {
  name: string;
  color: string;
  avatarKey?: string | null;
};

export function PersonAvatar({ person, size }: { person: AvatarPerson; size: number }) {
  const key = person.avatarKey;
  const src = isKidAvatarKey(key) ? KID_AVATARS[key] : null;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        backgroundColor: person.color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        <Image source={src} style={{ width: size, height: size }} />
      ) : (
        <Text
          style={{
            color: colors.paper,
            fontFamily: type.display,
            fontSize: Math.round(size * 0.42),
          }}
        >
          {person.name.slice(0, 1)}
        </Text>
      )}
    </View>
  );
}
