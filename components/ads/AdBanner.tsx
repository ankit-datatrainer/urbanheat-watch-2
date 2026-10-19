import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideInRight,
  SlideOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import PressableScale from "../ui/PressableScale";
import { F, C, R, shadow } from "../ui/theme";
import { tx, useI18n } from "../../lib/i18n";

type IconName = keyof typeof Ionicons.glyphMap;

type Ad = {
  id: string;
  sponsor: string;
  tagline: string;
  headline: string;
  offer: string;
  cta: string;
  icon: IconName;
  colors: readonly [string, string, string];
  accent: string;
  details: { icon: IconName; text: string }[];
  about: string;
};

// Placeholder sponsors for the demo. Replace with real campaigns when an advertiser signs on.
export const DEMO_ADS: Ad[] = [
  {
    id: "brightpath",
    sponsor: "Brightpath Academy",
    tagline: tx("Where curious minds grow"),
    headline: tx("STEM Summer Camp 2026"),
    offer: tx("Early bird 20% off"),
    cta: tx("Learn more"),
    icon: "school",
    colors: ["#3B2A8C", "#6A4FD8", "#9B7BFF"],
    accent: "#FFD166",
    details: [
      { icon: "hardware-chip-outline", text: tx("Robotics, coding & climate science") },
      { icon: "people-outline", text: tx("Ages 10 to 16, small groups of 12") },
      { icon: "snow-outline", text: tx("Fully air-conditioned, heat-safe campus") },
      { icon: "calendar-outline", text: tx("Two-week sessions from June to August") },
    ],
    about:
      "Brightpath Academy runs hands-on science programmes for young learners. This summer students build weather stations and map urban heat in their own neighbourhood.",
  },
  {
    id: "greenleaf",
    sponsor: "Greenleaf International School",
    tagline: tx("Learning in harmony with nature"),
    headline: tx("Open House this Saturday"),
    offer: tx("9 AM to 1 PM · Free entry"),
    cta: tx("Book a visit"),
    icon: "leaf",
    colors: ["#0F5E4B", "#2E9E7E", "#7DD3B0"],
    accent: "#FFE9A8",
    details: [
      { icon: "sunny-outline", text: tx("Shaded eco-campus with cool-zone classrooms") },
      { icon: "book-outline", text: tx("IB curriculum, Kindergarten to Grade 12") },
      { icon: "bus-outline", text: tx("Air-conditioned school buses citywide") },
      { icon: "gift-outline", text: tx("Waived application fee for visitors") },
    ],
    about:
      "Greenleaf International School is an IB World School with a sustainability-first campus. Meet teachers, tour the rooftop garden and see the student heat-research lab.",
  },
  {
    id: "sunrise",
    sponsor: "Sunrise Sports Academy",
    tagline: tx("Train hard. Stay cool."),
    headline: tx("Indoor heat-safe training"),
    offer: tx("Free trial class"),
    cta: tx("Claim trial"),
    icon: "football",
    colors: ["#B83A1E", "#F07B2E", "#FFB36B"],
    accent: "#FFFFFF",
    details: [
      { icon: "water-outline", text: tx("Hydration breaks every 20 minutes") },
      { icon: "thermometer-outline", text: tx("Sessions move indoors when WBGT is high") },
      { icon: "trophy-outline", text: tx("Football, swimming, badminton & athletics") },
      { icon: "time-outline", text: tx("Weekday evenings and weekend mornings") },
    ],
    about:
      "Sunrise Sports Academy coaches young athletes with heat-safety built into every session, following national WBGT activity guidelines.",
  },
];

const ROTATE_MS = 6000;

function Shimmer({ width }: { width: number }) {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 2600 }),
      ),
      -1,
      false,
    );
  }, [x]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -120 + x.value * (width + 240) }, { rotate: "18deg" }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.shimmer, style]}>
      <LinearGradient
        colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

function useFloat() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [t]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 * t.value }, { rotate: `${-6 + t.value * 12}deg` }],
  }));
  return style;
}

function Slide({ ad, width, onOpen }: { ad: Ad; width: number; onOpen: () => void }) {
  const { t } = useI18n();
  const floatStyle = useFloat();
  return (
    <PressableScale
      scaleTo={0.98}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${t("Sponsored")}: ${ad.sponsor}. ${t(ad.headline)}`}
    >
      <LinearGradient colors={ad.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.slide}>
        {/* Curved decorative waves */}
        <Svg width={width} height={170} viewBox={`0 0 ${width} 170`} style={StyleSheet.absoluteFill}>
          <Path
            d={`M0 120 C ${width * 0.3} 80, ${width * 0.55} 165, ${width} 105 L ${width} 170 L 0 170 Z`}
            fill="rgba(255,255,255,0.12)"
          />
          <Path
            d={`M0 145 C ${width * 0.35} 115, ${width * 0.6} 175, ${width} 135 L ${width} 170 L 0 170 Z`}
            fill="rgba(255,255,255,0.10)"
          />
          <Circle cx={width - 30} cy={18} r={56} fill="rgba(255,255,255,0.08)" />
          <Circle cx={width - 70} cy={-10} r={36} fill="rgba(255,255,255,0.07)" />
        </Svg>
        <Shimmer width={width} />

        <View style={styles.slideRow}>
          <View style={styles.flex}>
            <View style={styles.sponsorRow}>
              <View style={[styles.crest, { borderColor: ad.accent }]}>
                <Ionicons name={ad.icon} size={13} color={ad.accent} />
              </View>
              <Text style={styles.sponsor} numberOfLines={1}>
                {ad.sponsor}
              </Text>
            </View>
            <Text style={styles.headline} numberOfLines={2}>
              {t(ad.headline)}
            </Text>
            <Text style={[styles.offer, { color: ad.accent }]}>{t(ad.offer)}</Text>
            <View style={styles.cta}>
              <Text style={[styles.ctaText, { color: ad.colors[0] }]}>{t(ad.cta)}</Text>
              <Ionicons name="arrow-forward" size={14} color={ad.colors[0]} />
            </View>
          </View>
          <Animated.View style={[styles.emblem, floatStyle]}>
            <LinearGradient colors={["rgba(255,255,255,0.35)", "rgba(255,255,255,0.08)"]} style={styles.emblemInner}>
              <Ionicons name={ad.icon} size={40} color="#FFFFFF" />
            </LinearGradient>
          </Animated.View>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

function AdDetails({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  const { t } = useI18n();
  const [booked, setBooked] = useState(false);
  return (
    <View style={styles.sheetBackdrop}>
      <Animated.View entering={FadeIn} exiting={FadeOut} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdropPress} onPress={onClose} accessibilityLabel={t("Close")} />
      </Animated.View>
      <Animated.View entering={SlideInDown.springify().damping(18)} style={styles.sheet}>
        <LinearGradient colors={ad.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sheetHero}>
          <View style={styles.sheetGrabber} />
          <Ionicons name={ad.icon} size={34} color="#FFFFFF" />
          <Text style={styles.sheetSponsor}>{ad.sponsor}</Text>
          <Text style={styles.sheetTagline}>{t(ad.tagline)}</Text>
        </LinearGradient>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Text style={styles.sheetHeadline}>{t(ad.headline)}</Text>
          <Text style={[styles.sheetOffer, { color: ad.colors[1] }]}>{t(ad.offer)}</Text>
          <Text style={styles.sheetAbout}>{t(ad.about)}</Text>
          {ad.details.map((d) => (
            <View key={d.text} style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: `${ad.colors[1]}1F` }]}>
                <Ionicons name={d.icon} size={17} color={ad.colors[1]} />
              </View>
              <Text style={styles.detailText}>{t(d.text)}</Text>
            </View>
          ))}
          <PressableScale
            onPress={() => setBooked(true)}
            disabled={booked}
            style={[styles.sheetCta, { backgroundColor: booked ? C.low : ad.colors[1] }]}
          >
            <Ionicons name={booked ? "checkmark-circle" : "sparkles"} size={18} color="#FFFFFF" />
            <Text style={styles.sheetCtaText}>{booked ? t("Interest registered") : t(ad.cta)}</Text>
          </PressableScale>
          {booked && (
            <Animated.Text entering={FadeIn} style={styles.sheetNote}>
              {t("Thanks! {sponsor} will be in touch. (Demo advertisement)", { sponsor: ad.sponsor })}
            </Animated.Text>
          )}
          <Text style={styles.sheetDisclaimer}>
            {t("Sponsored content. UrbanHeat Watch does not endorse advertisers.")}
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** Curved, auto-rotating sponsored banner shown in-app. Opens an in-app details sheet on tap. */
export default function AdBanner({ ads = DEMO_ADS }: { ads?: Ad[] }) {
  const { t } = useI18n();
  const { width: screenW } = useWindowDimensions();
  const width = Math.min(screenW, 760) - 40;
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<Ad | null>(null);

  useEffect(() => {
    if (open || ads.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % ads.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [ads.length, open]);

  const ad = ads[index];

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{t("Sponsored")}</Text>
        <View style={styles.dots}>
          {ads.map((a, i) => (
            <Pressable
              key={a.id}
              onPress={() => setIndex(i)}
              hitSlop={8}
              accessibilityLabel={`${t("Sponsored")} ${i + 1}`}
            >
              <View style={[styles.dot, i === index && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.frame}>
        <Animated.View key={ad.id} entering={SlideInRight.springify().damping(20)} exiting={SlideOutLeft.duration(250)}>
          <Slide ad={ad} width={width} onOpen={() => setOpen(ad)} />
        </Animated.View>
      </View>

      <Modal visible={open !== null} transparent animationType="none" onRequestClose={() => setOpen(null)}>
        {open && <AdDetails ad={open} onClose={() => setOpen(null)} />}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", marginHorizontal: 20, marginTop: 20 },
  flex: { flex: 1 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  label: { fontSize: 10.5, fontFamily: F.bodySemi, letterSpacing: 1.6, color: "rgba(255,255,255,0.9)" },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { width: 18, backgroundColor: "#FFFFFF" },
  frame: {
    borderRadius: R.xl,
    borderTopRightRadius: 48,
    borderBottomLeftRadius: 48,
    overflow: "hidden",
    ...shadow(3),
  },
  slide: { height: 170, padding: 18, overflow: "hidden" },
  slideRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  sponsorRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  crest: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  sponsor: { color: "rgba(255,255,255,0.92)", fontSize: 12.5, fontFamily: F.bodySemi, flexShrink: 1 },
  headline: {
    color: "#FFFFFF",
    fontSize: 21,
    fontFamily: F.display,
    letterSpacing: -0.4,
    marginTop: 8,
    lineHeight: 25,
  },
  offer: { fontSize: 13, fontFamily: F.bodySemi, marginTop: 4 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: R.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 12,
  },
  ctaText: { fontSize: 13, fontFamily: F.bodySemi },
  emblem: { width: 84, height: 84 },
  emblemInner: {
    flex: 1,
    borderRadius: 42,
    borderTopLeftRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
  },
  shimmer: { position: "absolute", top: -40, bottom: -40, width: 90 },

  sheetBackdrop: { flex: 1, justifyContent: "flex-end" },
  backdropPress: { flex: 1, backgroundColor: "rgba(20,12,8,0.5)" },
  sheet: {
    maxHeight: "86%",
    backgroundColor: C.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  sheetHero: { alignItems: "center", paddingTop: 10, paddingBottom: 22, gap: 4 },
  sheetGrabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)", marginBottom: 12 },
  sheetSponsor: { color: "#FFFFFF", fontSize: 20, fontFamily: F.display, marginTop: 4 },
  sheetTagline: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: F.body },
  sheetBody: { padding: 22, paddingBottom: 40 },
  sheetHeadline: { fontSize: 22, fontFamily: F.display, color: C.ink, letterSpacing: -0.4 },
  sheetOffer: { fontSize: 14, fontFamily: F.bodySemi, marginTop: 4 },
  sheetAbout: { fontSize: 14, fontFamily: F.body, color: C.inkSoft, lineHeight: 21, marginTop: 12, marginBottom: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  detailIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  detailText: { flex: 1, fontSize: 14, color: C.ink, fontFamily: F.bodySemi },
  sheetCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: R.md,
    paddingVertical: 15,
    marginTop: 22,
  },
  sheetCtaText: { color: "#FFFFFF", fontSize: 16, fontFamily: F.bodySemi },
  sheetNote: { textAlign: "center", color: C.low, fontFamily: F.bodySemi, marginTop: 10, fontSize: 13 },
  sheetDisclaimer: { textAlign: "center", color: C.inkMuted, fontSize: 11, fontFamily: F.body, marginTop: 16 },
});
