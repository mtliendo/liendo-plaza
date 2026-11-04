import { ActionSheetIOS, Alert, Image, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { colors, curve, muted, type } from "@/lib/theme";

async function fromCamera() {
  const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
  if (shot.canceled || !shot.assets[0]) return null;
  return shot.assets[0].uri;
}

async function fromLibrary() {
  const shot = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    quality: 0.7,
    allowsEditing: false,
  });
  if (shot.canceled || !shot.assets[0]) return null;
  return shot.assets[0].uri;
}

export function PhotoField({
  uri,
  onPick,
  onClear,
}: {
  uri: string | null;
  onPick: (uri: string) => void;
  onClear?: () => void;
}) {
  function choose() {
    void Haptics.selectionAsync();
    const take = async () => {
      const next = await fromCamera();
      if (next) onPick(next);
    };
    const pick = async () => {
      const next = await fromLibrary();
      if (next) onPick(next);
    };
    const options = ["Take a photo", "Choose from library", ...(uri && onClear ? ["Remove photo"] : []), "Cancel"];
    const cancel = options.length - 1;
    const destructive = uri && onClear ? options.indexOf("Remove photo") : undefined;
    if (process.env.EXPO_OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: cancel, destructiveButtonIndex: destructive }, (index) => {
        if (index === 0) void take();
        else if (index === 1) void pick();
        else if (destructive === index) onClear?.();
      });
      return;
    }
    Alert.alert("Photo", undefined, [
      { text: "Take a photo", onPress: () => void take() },
      { text: "Choose from library", onPress: () => void pick() },
      ...(uri && onClear ? [{ text: "Remove photo", style: "destructive" as const, onPress: onClear }] : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={muted}>Photo</Text>
      {uri ? <Image source={{ uri }} style={{ width: "100%", height: 160, ...curve.card }} /> : null}
      <Pressable onPress={choose} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ color: colors.accent, fontFamily: type.body, fontSize: 16 }}>{uri ? "Change photo" : "Add a photo"}</Text>
      </Pressable>
    </View>
  );
}
