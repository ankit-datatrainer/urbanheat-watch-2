import { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { C } from "../ui/theme";

export type MascotMood = "idle" | "thinking" | "happy";

type Props = {
  /** Height of the character in px; width is ~0.72 of this. */
  size?: number;
  mood?: MascotMood;
  /** Orbiting AI halo with sparkles. */
  halo?: boolean;
  style?: StyleProp<ViewStyle>;
};

const INK = C.ink;
const loop = (anim: number) => withRepeat(anim, -1, false);

/**
 * The UrbanHeat Watch mascot (sprout + thermometer) rebuilt in vectors and brought to life
 * as the AI assistant: it bobs, blinks, waves, its sprout sways and its thermometer pulses.
 */
export default function AiMascot({ size = 120, mood = "idle", halo = false, style }: Props) {
  const u = size / 140;
  const W = 100 * u;
  const thinking = mood === "thinking";

  const bob = useSharedValue(0);
  const blink = useSharedValue(1);
  const sway = useSharedValue(0);
  const wave = useSharedValue(0);
  const mercury = useSharedValue(0.6);
  const look = useSharedValue(0);
  const spin = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    const speed = thinking ? 0.6 : 1;
    bob.value = loop(
      withSequence(
        withTiming(1, { duration: 1500 * speed, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1500 * speed, easing: Easing.inOut(Easing.sin) }),
      ),
    );
    blink.value = loop(
      withSequence(
        withDelay(2600, withTiming(0.08, { duration: 90 })),
        withTiming(1, { duration: 130 }),
        withDelay(180, withTiming(0.08, { duration: 80 })),
        withTiming(1, { duration: 120 }),
      ),
    );
    sway.value = loop(
      withSequence(
        withTiming(1, { duration: 1300 * speed, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1, { duration: 1300 * speed, easing: Easing.inOut(Easing.quad) }),
      ),
    );
    wave.value = loop(
      withSequence(
        withDelay(mood === "happy" ? 200 : 1800, withTiming(1, { duration: 220 })),
        withTiming(-0.3, { duration: 220 }),
        withTiming(1, { duration: 220 }),
        withTiming(0, { duration: 260 }),
      ),
    );
    mercury.value = loop(
      withSequence(
        withTiming(1, { duration: 1100 * speed, easing: Easing.out(Easing.quad) }),
        withTiming(0.45, { duration: 1400 * speed, easing: Easing.inOut(Easing.quad) }),
      ),
    );
    look.value = thinking
      ? loop(
          withSequence(
            withTiming(1, { duration: 500 }),
            withDelay(400, withTiming(-1, { duration: 700 })),
            withDelay(400, withTiming(0, { duration: 500 })),
          ),
        )
      : withTiming(0, { duration: 300 });
    spin.value = 0;
    spin.value = withRepeat(withTiming(1, { duration: thinking ? 2200 : 7000, easing: Easing.linear }), -1, false);
    glow.value = loop(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      ),
    );
    return () => {
      [bob, blink, sway, wave, mercury, look, spin, glow].forEach((v) => cancelAnimation(v));
    };
  }, [thinking, mood, bob, blink, sway, wave, mercury, look, spin, glow]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * u * bob.value }, { rotate: `${(bob.value - 0.5) * 3}deg` }],
  }));
  const leafStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${sway.value * (thinking ? 14 : 9)}deg` }] }));
  const eyeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: look.value * 1.6 * u }, { scaleY: blink.value }],
  }));
  const rightArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-wave.value * 34}deg` }] }));
  const leftArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${bob.value * 8}deg` }] }));
  const mercuryStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: mercury.value }] }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const counterSpin = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * 360}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + glow.value * 0.4,
    transform: [{ scale: 0.92 + glow.value * 0.12 }],
  }));

  const ring = size * 1.08;
  const box = halo ? ring : size;

  return (
    <View style={[{ width: halo ? ring : W, height: box, alignItems: "center", justifyContent: "center" }, style]}>
      {halo && (
        <>
          <Animated.View
            style={[
              styles.abs,
              glowStyle,
              { left: ring * 0.05, top: ring * 0.05, width: ring * 0.9, height: ring * 0.9, borderRadius: ring },
            ]}
          >
            <LinearGradient
              colors={["rgba(240,123,46,0.35)", "rgba(125,191,156,0.3)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1, borderRadius: ring }}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.abs,
              spinStyle,
              {
                left: 0,
                top: 0,
                width: ring,
                height: ring,
                borderRadius: ring / 2,
                borderWidth: Math.max(1.5, 2 * u),
                borderColor: "transparent",
                borderTopColor: C.brand,
                borderRightColor: C.leafLight,
              },
            ]}
          >
            {[0, 1, 2].map((i) => {
              const a = (i * 2 * Math.PI) / 3;
              const r = ring / 2;
              const s = Math.max(10, 13 * u);
              return (
                <Animated.View
                  key={i}
                  style={[
                    styles.abs,
                    counterSpin,
                    { left: r + Math.cos(a) * r - s / 2 - 1, top: r + Math.sin(a) * r - s / 2 - 1 },
                  ]}
                >
                  <Ionicons name="sparkles" size={s} color={i === 1 ? C.leaf : C.brand} />
                </Animated.View>
              );
            })}
          </Animated.View>
        </>
      )}

      <Animated.View style={[{ width: W, height: size }, bodyStyle]}>
        {/* Arms sit behind the body */}
        <Animated.View style={[styles.abs, { left: 3 * u, top: 60 * u, transformOrigin: "92% 83%" }, leftArmStyle]}>
          <Svg width={24 * u} height={24 * u} viewBox="0 0 24 24">
            <Path d="M22 20 L5 6" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.abs, { left: 73 * u, top: 60 * u, transformOrigin: "8% 83%" }, rightArmStyle]}>
          <Svg width={24 * u} height={24 * u} viewBox="0 0 24 24">
            <Path d="M2 20 L19 6" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          </Svg>
        </Animated.View>

        {/* Sprout */}
        <Animated.View
          style={[
            styles.abs,
            { left: 30 * u, top: 0, width: 40 * u, height: 30 * u, transformOrigin: "50% 100%" },
            leafStyle,
          ]}
        >
          <Svg width={40 * u} height={30 * u} viewBox="0 0 40 30">
            <Path d="M20 30 L20 14" stroke={INK} strokeWidth={3} strokeLinecap="round" />
            <Path d="M20 16 C 13 5, 3 7, 1 13 C 7 20, 15 21, 20 16 Z" fill="#6DB38E" />
            <Path d="M20 14 C 25 3, 36 1, 39 6 C 35 15, 27 18, 20 14 Z" fill={C.leafLight} />
          </Svg>
        </Animated.View>

        {/* Body capsule */}
        <View
          style={[
            styles.abs,
            {
              left: 24 * u,
              top: 25 * u,
              width: 52 * u,
              height: 94 * u,
              borderRadius: 26 * u,
              borderWidth: 3.5 * u,
              borderColor: INK,
              backgroundColor: "#FFFFFF",
            },
          ]}
        />

        {/* Face */}
        {[35, 58].map((x) => (
          <Animated.View
            key={x}
            style={[
              styles.abs,
              { left: x * u, top: 46 * u, width: 7.5 * u, height: 7.5 * u, borderRadius: 4 * u, backgroundColor: INK },
              eyeStyle,
            ]}
          >
            <View
              style={{
                position: "absolute",
                left: 1.4 * u,
                top: 1.2 * u,
                width: 2.4 * u,
                height: 2.4 * u,
                borderRadius: 2 * u,
                backgroundColor: "#FFFFFF",
              }}
            />
          </Animated.View>
        ))}
        {[29, 63].map((x) => (
          <View
            key={x}
            style={[
              styles.abs,
              {
                left: x * u,
                top: 56 * u,
                width: 8 * u,
                height: 5 * u,
                borderRadius: 3 * u,
                backgroundColor: "#F4A9A3",
                opacity: 0.85,
              },
            ]}
          />
        ))}
        <View style={[styles.abs, { left: 42 * u, top: 54 * u }]}>
          <Svg width={16 * u} height={10 * u} viewBox="0 0 16 10">
            <Path
              d={mood === "happy" ? "M2 2 Q8 11 14 2 Z" : thinking ? "M5 5 Q8 7 11 5" : "M2 2 Q8 9 14 2"}
              stroke={INK}
              strokeWidth={2.2}
              strokeLinecap="round"
              fill={mood === "happy" ? "#E0533D" : "none"}
            />
          </Svg>
        </View>

        {/* Thermometer: stem with pulsing mercury, then the bulb */}
        <View
          style={[
            styles.abs,
            {
              left: 43 * u,
              top: 70 * u,
              width: 14 * u,
              height: 40 * u,
              borderRadius: 7 * u,
              backgroundColor: "#F8D2B6",
              overflow: "hidden",
            },
          ]}
        >
          <Animated.View style={[{ flex: 1, backgroundColor: C.bulb, transformOrigin: "50% 100%" }, mercuryStyle]} />
        </View>
        <View
          style={[
            styles.abs,
            {
              left: 30 * u,
              top: 99 * u,
              width: 40 * u,
              height: 40 * u,
              borderRadius: 20 * u,
              borderWidth: 3.5 * u,
              borderColor: INK,
              backgroundColor: C.bulb,
            },
          ]}
        >
          <View
            style={{
              position: "absolute",
              left: 7 * u,
              top: 6 * u,
              width: 9 * u,
              height: 6 * u,
              borderRadius: 4 * u,
              backgroundColor: "rgba(255,255,255,0.45)",
            }}
          />
        </View>
      </Animated.View>
    </View>
  );
}

/** Circular avatar version for chat rows and buttons. */
export function AiAvatar({ size = 32, mood = "idle" }: { size?: number; mood?: MascotMood }) {
  const h = size * 1.2;
  return (
    <LinearGradient
      colors={["#FFE7D2", "#E4F2EA"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        alignItems: "center",
        borderWidth: 1.5,
        borderColor: "#F3C9A6",
      }}
    >
      <AiMascot size={h} mood={mood} style={{ marginTop: size * 0.02 }} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
});
