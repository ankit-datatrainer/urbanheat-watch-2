import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AiMascot from "../components/ai/AiMascot";
import PressableScale from "../components/ui/PressableScale";
import { LanguageList } from "../components/LanguagePicker";
import { tx, useT } from "../lib/i18n";
import { ONBOARDED_KEY } from "../lib/onboarding";
import { C, F, R, shadow } from "../components/ui/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const SLIDES: { icon: IconName; colors: readonly [string, string]; title: string; body: string }[] = [
  {
    icon: "planet",
    colors: ["#E2621B", "#F5A262"],
    title: tx("Satellite heat map"),
    body: tx(
      "See how hot the ground in your city really is, measured from space by NASA satellites and updated as new passes arrive.",
    ),
  },
  {
    icon: "notifications",
    colors: ["#C7341F", "#F07B2E"],
    title: tx("Alerts before it gets dangerous"),
    body: tx("Heat stress, UV, air quality and the coolest time to go outside, refreshed automatically for your city."),
  },
  {
    icon: "people",
    colors: ["#3E8A68", "#7DBF9C"],
    title: tx("Look after your family"),
    body: tx(
      "Invite parents and grandparents by WhatsApp, email or a link, and get a nudge to check on them on hot days.",
    ),
  },
  {
    icon: "sparkles",
    colors: ["#5B3FD0", "#9B7BFF"],
    title: tx("Ask the AI assistant"),
    body: tx("Hydration plans, safe exercise times and heat questions answered in your own language."),
  },
];

function Dot({ active }: { active: boolean }) {
  const w = useSharedValue(active ? 22 : 7);
  useEffect(() => {
    w.set(withSpring(active ? 22 : 7, { damping: 15 }));
  }, [active, w]);
  const style = useAnimatedStyle(() => ({ width: w.value }));
  return <Animated.View style={[styles.dot, active && styles.dotOn, style]} />;
}

export default function OnboardingScreen() {
  const t = useT();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  // Horizontal pages need an explicit height to fill the space between header and footer.
  const [pageH, setPageH] = useState(0);
  const total = SLIDES.length + 1; // the last page is the language choice
  const last = page === total - 1;

  function goTo(p: number) {
    scroll.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  }

  async function finish() {
    await AsyncStorage.setItem(ONBOARDED_KEY, "1").catch(() => {});
    router.replace("/login");
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <Text style={styles.brand}>UrbanHeat Watch</Text>
        {!last && (
          <PressableScale onPress={() => goTo(total - 1)} style={styles.skip}>
            <Text style={styles.skipText}>{t("Skip")}</Text>
          </PressableScale>
        )}
      </View>

      <View style={styles.flex} onLayout={(e) => setPageH(e.nativeEvent.layout.height)}>
        <ScrollView
          ref={scroll}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          onScroll={(e) => {
            const p = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
            if (p !== page) setPage(p);
          }}
          scrollEventThrottle={32}
          style={styles.pager}
        >
          {SLIDES.map((s, i) => (
            <View key={s.title} style={[styles.page, { width, height: pageH || undefined }]}>
              <View style={styles.art}>
                <LinearGradient colors={s.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.blob} />
                {i === 0 ? (
                  <AiMascot size={190} mood="happy" halo />
                ) : (
                  <View style={styles.iconCircle}>
                    <Ionicons name={s.icon} size={64} color={s.colors[0]} />
                  </View>
                )}
              </View>
              <Text style={styles.step}>
                {i + 1} / {SLIDES.length}
              </Text>
              <Text style={styles.title}>{t(s.title)}</Text>
              <Text style={styles.body}>{t(s.body)}</Text>
            </View>
          ))}

          <ScrollView style={{ width, height: pageH || undefined }} contentContainerStyle={styles.langPage}>
            <Animated.View entering={FadeInUp.springify()} style={styles.langHead}>
              <View style={styles.langIcon}>
                <Ionicons name="language" size={30} color={C.brand} />
              </View>
              <Text style={styles.title}>{t("Choose your language")}</Text>
              <Text style={styles.body}>{t("You can change it any time from the home screen.")}</Text>
            </Animated.View>
            <LanguageList />
          </ScrollView>
        </ScrollView>
      </View>

      <Animated.View entering={FadeInDown.delay(200)} style={styles.footer}>
        <View style={styles.dots}>
          {Array.from({ length: total }, (_, i) => (
            <Dot key={i} active={i === page} />
          ))}
        </View>
        <PressableScale onPress={() => (last ? finish() : goTo(page + 1))} style={styles.next}>
          <Text style={styles.nextText}>{last ? t("Get started") : t("Next")}</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </PressableScale>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  pager: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 8,
    height: 48,
  },
  brand: { fontSize: 17, fontFamily: F.display, color: C.ink, letterSpacing: -0.3 },
  skip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  skipText: { fontSize: 13, fontFamily: F.bodyMedium, color: C.inkSoft },

  page: { paddingHorizontal: 32, justifyContent: "center", alignItems: "center" },
  art: { width: 260, height: 260, alignItems: "center", justifyContent: "center", marginBottom: 26 },
  blob: { position: "absolute", width: 230, height: 230, borderRadius: 115, borderTopLeftRadius: 60, opacity: 0.22 },
  iconCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow(2),
  },
  step: { fontSize: 12, fontFamily: F.bodyMedium, color: C.brand, letterSpacing: 1.2 },
  title: {
    fontSize: 28,
    fontFamily: F.display,
    color: C.ink,
    textAlign: "center",
    marginTop: 8,
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  body: {
    fontSize: 15.5,
    fontFamily: F.body,
    color: C.inkSoft,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 23,
    maxWidth: 380,
  },

  langPage: { paddingHorizontal: 24, paddingBottom: 24, width: "100%", maxWidth: 520, alignSelf: "center" },
  langHead: { alignItems: "center", marginBottom: 18, marginTop: 10 },
  langIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { height: 7, borderRadius: 4, backgroundColor: C.borderStrong },
  dotOn: { backgroundColor: C.brand },
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.ink,
    borderRadius: R.pill,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  nextText: { color: "#FFFFFF", fontSize: 15, fontFamily: F.bodySemi },
});
