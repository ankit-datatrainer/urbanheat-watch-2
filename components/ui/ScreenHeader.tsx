import { useEffect, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { F, C } from "./theme";

/** Large screen title with an eyebrow label and an accent bar that draws itself in. */
export default function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const bar = useSharedValue(0);
  useEffect(() => {
    bar.value = withDelay(250, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [bar]);
  const barStyle = useAnimatedStyle(() => ({ width: 44 * bar.value, opacity: bar.value }));

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.flex}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </View>
        {right}
      </View>
      <Animated.View style={[styles.barWrap, barStyle]}>
        <LinearGradient
          colors={[C.brand, C.leafLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.bar}
        />
      </Animated.View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  flex: { flex: 1 },
  eyebrow: { fontSize: 12, fontFamily: F.bodySemi, color: C.brand, letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontSize: 30, fontFamily: F.display, color: C.ink, letterSpacing: -0.8, marginTop: 2 },
  barWrap: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 8 },
  bar: { flex: 1 },
  subtitle: { fontSize: 14.5, fontFamily: F.body, color: C.inkSoft, marginTop: 10, lineHeight: 20 },
});
