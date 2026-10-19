import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import PressableScale from "../ui/PressableScale";
import AiMascot from "./AiMascot";
import { F, C, shadow } from "../ui/theme";
import { tx, useI18n } from "../../lib/i18n";

const HINTS = [tx("Ask me about the heat!"), tx("Need a hydration plan?"), tx("How hot is it outside?")];

/** Floating AI assistant button: the animated mascot with a speech bubble that pops up now and then. */
export default function AiFab({ query, lift = 0 }: { query?: string; lift?: number }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [hint, setHint] = useState<number | null>(0);

  useEffect(() => {
    let i = 0;
    const hide = setTimeout(() => setHint(null), 4500);
    const timer = setInterval(() => {
      i = (i + 1) % HINTS.length;
      setHint(i);
      setTimeout(() => setHint(null), 4000);
    }, 14000);
    return () => {
      clearTimeout(hide);
      clearInterval(timer);
    };
  }, []);

  // Native tab bars float over the content; the web tab bar takes its own space.
  const bottom = (Platform.OS === "web" ? 18 : insets.bottom + 72) + lift;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      {hint !== null && (
        <Animated.View key={hint} entering={FadeIn.duration(250)} exiting={FadeOut.duration(200)} style={styles.bubble}>
          <Text style={styles.bubbleText}>{t(HINTS[hint]!)}</Text>
          <View style={styles.bubbleTail} />
        </Animated.View>
      )}
      <Animated.View entering={ZoomIn.delay(500).springify().damping(12)}>
        <PressableScale
          scaleTo={0.9}
          onPress={() => router.push(query ? { pathname: "/ai", params: { query } } : "/ai")}
          accessibilityRole="button"
          accessibilityLabel={t("Ask UrbanHeat Watch AI")}
        >
          <LinearGradient
            colors={["#FFF4EA", "#FFE2CB"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fab}
          >
            <AiMascot size={50} />
          </LinearGradient>
          <View style={styles.aiTag}>
            <Text style={styles.aiTagText}>AI</Text>
          </View>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 16, alignItems: "flex-end", gap: 8 },
  fab: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.brand,
    ...shadow(3),
  },
  aiTag: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: C.leaf,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  aiTagText: { color: "#FFFFFF", fontSize: 10, fontFamily: F.bodySemi, letterSpacing: 0.5 },
  bubble: {
    backgroundColor: C.ink,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 200,
    ...shadow(2),
  },
  bubbleText: { color: "#FFFFFF", fontSize: 12.5, fontFamily: F.bodySemi },
  bubbleTail: {
    position: "absolute",
    right: 26,
    bottom: -5,
    width: 10,
    height: 10,
    backgroundColor: C.ink,
    transform: [{ rotate: "45deg" }],
  },
});
