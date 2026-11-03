import { useEffect } from "react";
import { Image, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/lib/theme";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export function SplashHouse({ playing }: { playing: boolean }) {
  const reduced = useReducedMotion();
  const houseY = useSharedValue(reduced ? 0 : -10);
  const houseScale = useSharedValue(reduced ? 1 : 0.96);
  const houseOpacity = useSharedValue(1);
  const sunY = useSharedValue(reduced ? 0 : 18);
  const sunOpacity = useSharedValue(reduced ? 1 : 0);
  const smokeY = useSharedValue(0);
  const smokeOpacity = useSharedValue(reduced ? 0 : 0);

  useEffect(() => {
    if (!playing) return;
    if (reduced) return;
    houseY.set(withTiming(0, { duration: 700, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
    houseScale.set(withTiming(1, { duration: 700, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
    sunOpacity.set(withTiming(1, { duration: 800, easing: EASE_OUT }));
    sunY.set(withTiming(0, { duration: 1100, easing: EASE_OUT }));
    smokeOpacity.set(withDelay(400, withTiming(0.7, { duration: 500 })));
    smokeY.set(
      withDelay(
        400,
        withRepeat(withSequence(withTiming(-16, { duration: 1400, easing: EASE_OUT }), withTiming(0, { duration: 0 })), -1),
      ),
    );
  }, [houseScale, houseY, playing, reduced, smokeOpacity, smokeY, sunOpacity, sunY]);

  const houseStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: houseY.get() }, { scale: houseScale.get() }],
    opacity: houseOpacity.get(),
  }));
  const sunStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sunY.get() }],
    opacity: sunOpacity.get(),
  }));
  const smokeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: smokeY.get() }],
    opacity: smokeOpacity.get(),
  }));

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" }}
      accessibilityLabel="Liendo Plaza"
    >
      <View style={{ width: 220, height: 220 }}>
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 18,
              left: 46,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#E6C15A",
            },
            sunStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 28,
              right: 58,
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: "#C9B8A4",
            },
            smokeStyle,
          ]}
        />
        <Animated.View style={[{ width: 220, height: 220 }, houseStyle]}>
          <Image
            source={require("../assets/brand/icon-house-source.png")}
            style={{ width: 220, height: 220 }}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
    </View>
  );
}
