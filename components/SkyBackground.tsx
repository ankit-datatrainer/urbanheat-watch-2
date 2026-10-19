import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Animated, Dimensions, Easing, Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const { width: W, height: H } = Dimensions.get("window");
const useNative = Platform.OS !== "web"; // web doesn't support the native animation driver

type Props = {
  mode?: "day" | "night"; // leave out to follow the clock automatically
  /** Hide the sun and moon when content sits right under the status bar. */
  showSunMoon?: boolean;
  children?: ReactNode;
};

// Day = 7am to 7pm (Singapore sunrise/sunset barely change through the year)
function isDaytime() {
  const h = new Date().getHours();
  return h >= 7 && h < 19;
}

/* ---------- Drifting cloud ---------- */
function Cloud({ top, size, duration, opacity }: { top: number; size: number; duration: number; opacity: number }) {
  const [x] = useState(() => new Animated.Value(0));
  const [startAt] = useState(() => Math.random()); // each cloud starts somewhere different

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: useNative })
    );
    loop.start();
    return () => loop.stop();
  }, [x, duration]);

  const progress = Animated.modulo(Animated.add(x, startAt), 1);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-size * 2, W + size] });

  return (
    <Animated.View style={{ position: "absolute", top, opacity, transform: [{ translateX }] }}>
      <View style={{ width: size * 1.8, height: size * 0.6, borderRadius: size, backgroundColor: "#FFFFFF" }} />
      <View style={{ position: "absolute", left: size * 0.3, top: -size * 0.35, width: size * 0.8, height: size * 0.8, borderRadius: size, backgroundColor: "#FFFFFF" }} />
      <View style={{ position: "absolute", left: size * 0.85, top: -size * 0.2, width: size * 0.6, height: size * 0.6, borderRadius: size, backgroundColor: "#FFFFFF" }} />
    </Animated.View>
  );
}

/* ---------- Twinkling star ---------- */
function Star({ x, y, size }: { x: number; y: number; size: number }) {
  const [o] = useState(() => new Animated.Value(Math.random()));

  useEffect(() => {
    const speed = 1200 + Math.random() * 2000;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: speed, useNativeDriver: useNative }),
        Animated.timing(o, { toValue: 0.2, duration: speed, useNativeDriver: useNative }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [o]);

  return (
    <Animated.View
      style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: "#FFFFFF", opacity: o }}
    />
  );
}

/* ---------- Pulsing sun ---------- */
function Sun() {
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative }),
        Animated.timing(pulse, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.sunWrap}>
      <Animated.View style={[styles.sunGlow, { transform: [{ scale: pulse }] }]} />
      <View style={styles.sunCore} />
    </View>
  );
}

/* ---------- Main component ---------- */
export default function SkyBackground({ mode, showSunMoon = true, children }: Props) {
  // "live" part: re-check the clock every minute so it switches at 7am / 7pm by itself
  const [autoDay, setAutoDay] = useState(isDaytime());

  useEffect(() => {
    const timer = setInterval(() => setAutoDay(isDaytime()), 60000);
    return () => clearInterval(timer);
  }, []);

  const day = mode ? mode === "day" : autoDay;

  const [stars] = useState(() =>
      Array.from({ length: 60 }, (_, i) => ({
        id: i,
        x: Math.random() * W,
        y: Math.random() * H * 0.6,
        size: Math.random() * 2 + 1,
      }))
  );

  return (
    <View style={styles.fill}>
      <LinearGradient
        colors={day ? (["#3F87D9", "#73B3EE", "#BFDDF7"] as const) : (["#0B1026", "#1B2350", "#2E3A73"] as const)}
        style={StyleSheet.absoluteFill}
      />

      {day ? (
        <>
          {showSunMoon && <Sun />}
          <Cloud top={110} size={70} duration={60000} opacity={0.85} />
          <Cloud top={220} size={50} duration={80000} opacity={0.6} />
          <Cloud top={330} size={90} duration={100000} opacity={0.45} />
        </>
      ) : (
        <>
          {stars.map((s) => (
            <Star key={s.id} x={s.x} y={s.y} size={s.size} />
          ))}
          {showSunMoon && (
            <>
              <View style={styles.moonGlow} />
              <View style={styles.moon} />
            </>
          )}
        </>
      )}

      {/* screen content sits on top of the sky */}
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sunWrap: { position: "absolute", top: 60, right: 40, width: 120, height: 120, alignItems: "center", justifyContent: "center" },
  sunGlow: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(255, 236, 170, 0.35)" },
  sunCore: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#FFE9A8" },
  moonGlow: { position: "absolute", top: 52, right: 32, width: 92, height: 92, borderRadius: 46, backgroundColor: "rgba(244, 241, 232, 0.12)" },
  moon: { position: "absolute", top: 70, right: 50, width: 56, height: 56, borderRadius: 28, backgroundColor: "#F4F1E8" },
});
