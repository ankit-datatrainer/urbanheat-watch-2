import { useEffect, useState } from "react";
import { AppState, Image, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import SkyBackground from "../../components/SkyBackground";
import { emergency } from "../../components/emergencyNumbers";
import { CityHeat, HeatBand, fetchCityHeat } from "../../lib/heat";
import { useCity } from "../../components/CityContext";
import AdBanner from "../../components/ads/AdBanner";
import AiMascot from "../../components/ai/AiMascot";
import AiFab from "../../components/ai/AiFab";
import CityPicker from "../../components/CityPicker";
import LanguageButton from "../../components/LanguagePicker";
import SatelliteHeatPanel from "../../components/satellite/SatelliteHeatPanel";
import PressableScale from "../../components/ui/PressableScale";
import Reveal from "../../components/ui/Reveal";
import { C, F, R, shadow } from "../../components/ui/theme";
import { useAlerts } from "../../context/alerts";
import { useAuth } from "../../context/auth";
import { tx, useI18n, type TFunction } from "../../lib/i18n";

const BAND_COLOURS: Record<HeatBand, string> = {
  Low: "#2E9E7E",
  Moderate: "#F0A52E",
  High: "#E0533D",
};

const HEAT_REFRESH_MS = 5 * 60_000;

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function WhatToDoCard({ band, country, t }: { band: HeatBand; country: string; t: TFunction }) {
  const found = emergency.find((e) => e.country === country);
  const number = found ? String(found.no) : t("your local emergency number");
  const icon = band === "High" ? "flame" : band === "Moderate" ? "alert-circle" : "shield-checkmark";
  const title =
    band === "High" ? t("High heat stress") : band === "Moderate" ? t("Moderate heat stress") : t("Low heat stress");

  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>{t("WHAT TO DO NOW")}</Text>
      <View style={styles.iconTitleRow}>
        <Ionicons name={icon} size={20} color="#FFFFFF" />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>

      {band === "Low" && (
        <>
          <Text style={styles.text}>{t("Normal outdoor activities are OK.")}</Text>
          <Bullet>{t("Drink water regularly, even if you're not thirsty.")}</Bullet>
          <Bullet>{t("Wear light, loose clothing.")}</Bullet>
          <Bullet>{t("Rest in the shade if you feel tired.")}</Bullet>
          <Text style={styles.cardSub}>{t("For older adults")}</Text>
          <Text style={styles.text}>{t("Keep a water bottle with you when you go out.")}</Text>
        </>
      )}

      {band === "Moderate" && (
        <>
          <Text style={styles.text}>
            {t("Heat can start to affect your body. Cut down on long or hard outdoor activity.")}
          </Text>
          <Bullet>{t("Take breaks in the shade or indoors.")}</Bullet>
          <Bullet>{t("Drink water at least every hour.")}</Bullet>
          <Bullet>{t("Do outdoor chores and exercise in the early morning or evening.")}</Bullet>
          <Text style={styles.cardSub}>{t("For older adults")}</Text>
          <Text style={styles.text}>
            {t("Avoid going outdoors in the hottest part of the day. Stay somewhere cool if you can.")}
          </Text>
          <Text style={styles.cardSub}>{t("For family")}</Text>
          <Text style={styles.text}>
            {t("Call or message an elderly relative to check they're drinking water and staying cool.")}
          </Text>
        </>
      )}

      {band === "High" && (
        <>
          <Text style={styles.text}>{t("Heat illness is likely. Stay out of the heat as much as possible.")}</Text>
          <Bullet>{t("Stay indoors or in the shade during the hottest hours.")}</Bullet>
          <Bullet>{t("Postpone exercise and heavy outdoor activities.")}</Bullet>
          <Bullet>{t("Drink water regularly, and use a fan or air-conditioning to cool down.")}</Bullet>
          <Text style={styles.cardSub}>{t("For older adults")}</Text>
          <Text style={styles.text}>
            {t("Stay indoors in a cool place. Don't wait until you feel thirsty to drink.")}
          </Text>
          <Text style={styles.cardSub}>{t("For family")}</Text>
          <Text style={styles.text}>{t("Check on elderly relatives today, ideally in person or by video call.")}</Text>
        </>
      )}

      {band !== "Low" && (
        <View style={styles.warningBox}>
          <View style={styles.iconTitleRow}>
            <Ionicons name="warning-outline" size={17} color="#FFFFFF" />
            <Text style={styles.cardSubInline}>{t("Warning signs")}</Text>
          </View>
          <Text style={styles.text}>
            {t(
              "Get help if someone has dizziness, headache, nausea, cramps, heavy sweating or weakness. Move them somewhere cool, give water and cool their skin.",
            )}
          </Text>
          <Text style={styles.text}>
            {t("If someone is confused, faints, or has hot skin and stops sweating, call {number} right away.", {
              number,
            })}
          </Text>
        </View>
      )}
    </View>
  );
}

function aiSuggestions(cityName: string, country: string, heat: CityHeat | null, t: TFunction) {
  const now = heat ? ` (WBGT ${heat.wbgt}°C, ${heat.humidity}% humidity right now)` : "";
  return [
    {
      icon: "walk-outline" as const,
      label: t("Is it safe to exercise outside today?"),
      query: `Is it safe to exercise outdoors in ${cityName}, ${country} today${now}? Give a clear yes/no and timing advice.`,
    },
    {
      icon: "time-outline" as const,
      label: t("Best hours to be outdoors in {city}", { city: t(cityName) }),
      query: `What are the coolest, safest hours to be outdoors in ${cityName}, ${country} this week, and why?`,
    },
    {
      icon: "business-outline" as const,
      label: t("Urban heat island in {city}", { city: t(cityName) }),
      query: `Analyze heat stress and the urban heat island effect in ${cityName}, ${country}. Which areas run hottest?`,
    },
    {
      icon: "heart-outline" as const,
      label: t("Protect elderly family members"),
      query: `Give me a heat safety checklist for elderly family members living in ${cityName}, ${country}.`,
    },
  ];
}

function PulseDot({ color }: { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false));
  }, [p]);
  const ring = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ scale: 1 + p.value * 1.8 }] }));
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color }, ring]} />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

const UNLOCKS: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: "notifications", label: tx("Live heat alerts") },
  { icon: "people", label: tx("Family safety check-ins") },
  { icon: "sparkles", label: tx("AI heat assistant") },
  { icon: "map", label: tx("Full-screen heat map") },
];

/** Shown to guests: what an account adds, and the way to get one. */
function UnlockCard({ t, onRegister, onSignIn }: { t: TFunction; onRegister: () => void; onSignIn: () => void }) {
  return (
    <View style={styles.unlockCard}>
      <View style={styles.unlockHead}>
        <View style={styles.unlockIcon}>
          <Ionicons name="lock-open" size={18} color="#FFFFFF" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.unlockTitle}>{t("Register to unlock more features")}</Text>
          <Text style={styles.unlockSub}>{t("A free account adds:")}</Text>
        </View>
      </View>
      {UNLOCKS.map((u) => (
        <View key={u.label} style={styles.unlockRow}>
          <Ionicons name={u.icon} size={16} color={C.brand} />
          <Text style={styles.unlockText}>{t(u.label)}</Text>
        </View>
      ))}
      <PressableScale onPress={onRegister} style={styles.unlockBtn} accessibilityRole="button">
        <Text style={styles.unlockBtnText}>{t("Create free account")}</Text>
        <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
      </PressableScale>
      <PressableScale onPress={onSignIn} style={styles.unlockLink} accessibilityRole="button">
        <Text style={styles.unlockLinkText}>{t("I already have an account")}</Text>
      </PressableScale>
    </View>
  );
}

export default function HomeScreen() {
  const { city } = useCity();
  const { t } = useI18n();
  const { unread } = useAlerts();
  const { user, isGuest, leaveGuest } = useAuth();
  const guest = isGuest && !user;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // The reading is tagged with its city, so switching city shows a placeholder without resetting state in an effect.
  const [reading, setReading] = useState<{ cityId: string; heat: CityHeat | null } | null>(null);
  const heat = reading?.cityId === city.id ? reading.heat : null;

  useEffect(() => {
    let cancelled = false;
    const cityId = city.id;
    const load = () =>
      fetchCityHeat(city.lat, city.lon)
        .then((h) => !cancelled && setReading({ cityId, heat: h }))
        .catch(() => !cancelled && setReading((r) => (r?.cityId === cityId ? r : { cityId, heat: null })));
    load();
    const timer = setInterval(load, HEAT_REFRESH_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && load());
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [city]);

  // The first screen is the header plus the satellite map, sized to fit above the tab bar.
  // Guests have no tab bar.
  const tabBar = guest ? insets.bottom + 8 : Platform.OS === "web" ? 70 + insets.bottom : 60 + insets.bottom;
  const firstScreen = Math.max(520, height - insets.top - tabBar);
  const suggestions = aiSuggestions(city.name, city.country, heat, t);
  const bandLabel = heat ? t(`${heat.band} heat stress`) : null;

  // Guests leave guest mode and land on the account screen.
  // Navigate first: leaving guest mode while still on the tabs would trigger their plain
  // redirect to /login and lose the chosen form.
  const goToAccount = (mode: "signUp" | "signIn") => {
    router.replace({ pathname: "/login", params: { mode } });
    leaveGuest();
  };

  return (
    <SkyBackground showSunMoon={false}>
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.firstScreen, { height: firstScreen }]}>
            {/* Brand: app name on top, then the NYP logo (left) and the presenter (right) */}
            <Reveal index={0} style={styles.brandBlock}>
              <Text style={styles.appName} numberOfLines={1} adjustsFontSizeToFit>
                UrbanHeat Watch
              </Text>
              <View style={styles.brandRow}>
                <View style={styles.logoTile}>
                  <Image
                    source={require("../../assets/nyp-logo.png")}
                    style={styles.logo}
                    resizeMode="contain"
                    accessibilityLabel="Nanyang Polytechnic"
                  />
                </View>
                <Text style={styles.presenterLine} numberOfLines={1} adjustsFontSizeToFit>
                  {t("Presented by")} <Text style={styles.presenterName}>Mary Katrina</Text>
                </Text>
              </View>
            </Reveal>

            {/* Location, language, notifications */}
            <Reveal index={0} style={styles.header}>
              <CityPicker />
              <View style={styles.headerRight}>
                <LanguageButton tone="light" />
                <PressableScale
                  onPress={() => (guest ? goToAccount("signUp") : router.push("/alerts"))}
                  style={styles.bell}
                  accessibilityLabel={t("Alerts")}
                >
                  <Ionicons name="notifications-outline" size={18} color="#FFFFFF" />
                  {unread > 0 && !guest && (
                    <View style={styles.bellBadge}>
                      <Text style={styles.bellBadgeText}>{unread}</Text>
                    </View>
                  )}
                </PressableScale>
              </View>
            </Reveal>

            {/* Small live strip: air temperature and heat stress */}
            <Reveal index={1} style={styles.strip}>
              <Text style={styles.stripTemp}>{heat ? `${Math.round(heat.temperature)}°` : "--°"}</Text>
              <View style={styles.flex}>
                <Text style={styles.stripCity} numberOfLines={1}>
                  {city.name === city.country ? t(city.name) : `${t(city.name)}, ${t(city.country)}`}
                </Text>
                <Text style={styles.stripMeta} numberOfLines={1}>
                  {heat ? `${t("Humidity")} ${heat.humidity}% · WBGT ${heat.wbgt}°` : t("Loading live reading…")}
                </Text>
              </View>
              {heat && (
                <View style={[styles.bandPill, { backgroundColor: BAND_COLOURS[heat.band] }]}>
                  <PulseDot color="#FFFFFF" />
                  <Text style={styles.bandText} numberOfLines={1}>
                    {bandLabel}
                  </Text>
                </View>
              )}
            </Reveal>

            {/* Satellite heat map: the main view */}
            <Reveal index={2} style={styles.mapCard}>
              <SatelliteHeatPanel style={styles.flex} />
            </Reveal>
          </View>

          <View style={styles.scrollHint}>
            <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.7)" />
          </View>

          {/* Sponsored banner sits right before the AI suggestions */}
          <AdBanner />

          {guest && (
            <Reveal index={3} style={styles.stretch}>
              <UnlockCard t={t} onRegister={() => goToAccount("signUp")} onSignIn={() => goToAccount("signIn")} />
            </Reveal>
          )}

          {/* City-based AI suggestions (members only) */}
          {!guest && (
            <Reveal index={3} style={styles.aiCard}>
              <LinearGradient
                colors={["#FFF7EF", "#FDEBDD"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.aiInner}
              >
                <View style={styles.aiHeaderRow}>
                  <AiMascot size={74} mood="happy" />
                  <View style={styles.flex}>
                    <View style={styles.aiBadge}>
                      <Ionicons name="sparkles" size={11} color="#FFFFFF" />
                      <Text style={styles.aiBadgeText}>{t("AI SUGGESTIONS")}</Text>
                    </View>
                    <Text style={styles.aiTitle}>{t("Smart picks for {city}", { city: t(city.name) })}</Text>
                    <Text style={styles.aiDesc}>
                      {t("Tailored to today's heat. Tap a question to ask UrbanHeat Watch AI.")}
                    </Text>
                  </View>
                </View>
                {suggestions.map((sug) => (
                  <PressableScale
                    key={sug.query}
                    scaleTo={0.98}
                    onPress={() => router.push({ pathname: "/ai", params: { query: sug.query } })}
                    style={styles.sugRow}
                  >
                    <View style={styles.sugIcon}>
                      <Ionicons name={sug.icon} size={17} color={C.brandDeep} />
                    </View>
                    <Text style={styles.sugText}>{sug.label}</Text>
                    <Ionicons name="arrow-forward" size={15} color={C.brand} />
                  </PressableScale>
                ))}
                <PressableScale onPress={() => router.push("/ai")} style={styles.askBtn}>
                  <Ionicons name="chatbubbles-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.askText}>{t("Ask the assistant anything")}</Text>
                </PressableScale>
              </LinearGradient>
            </Reveal>
          )}

          {heat && !guest && (
            <Reveal index={4} style={styles.stretch}>
              <WhatToDoCard band={heat.band} country={city.country} t={t} />
              <Text style={styles.sourceNote}>
                {t(
                  "Heat-stress guidance uses air temperature and humidity from {source}; satellites measure ground temperature only.",
                  {
                    source: heat.stationName ?? heat.source,
                  },
                )}
              </Text>
            </Reveal>
          )}
        </ScrollView>
        {!guest && (
          <AiFab lift={150} query={`What should I know about the heat in ${city.name}, ${city.country} today?`} />
        )}
      </SafeAreaView>
    </SkyBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stretch: { alignSelf: "stretch" },
  content: { paddingBottom: 140, width: "100%", maxWidth: 760, alignSelf: "center" },
  firstScreen: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, gap: 10 },

  brandBlock: { alignItems: "center", gap: 8 },
  brandRow: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  appName: { color: "#FFFFFF", fontSize: 22, fontFamily: F.display, letterSpacing: -0.5, textAlign: "center" },
  logoTile: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow(1),
  },
  logo: { width: 58, height: 26 },
  presenterLine: { flexShrink: 1, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: F.bodyMedium, textAlign: "right" },
  presenterName: { color: "#FFFFFF", fontFamily: F.bodySemi },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  bell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.high,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  bellBadgeText: { color: "#FFFFFF", fontSize: 10, fontFamily: F.bodySemi },

  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // Dark glass keeps the white text readable when a background cloud drifts behind it.
    backgroundColor: "rgba(14,30,60,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: R.lg,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  stripTemp: { color: "#FFFFFF", fontSize: 30, fontFamily: F.displayLight, letterSpacing: -1 },
  stripCity: { color: "#FFFFFF", fontSize: 13.5, fontFamily: F.bodySemi },
  stripMeta: { color: "rgba(255,255,255,0.8)", fontSize: 11.5, fontFamily: F.body, marginTop: 1 },
  bandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 150,
  },
  bandText: { color: "#FFFFFF", fontSize: 11.5, fontFamily: F.bodySemi, flexShrink: 1 },
  pulseWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },

  mapCard: {
    flex: 1,
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    ...shadow(3),
  },
  scrollHint: { alignItems: "center", marginTop: -2 },

  aiCard: {
    alignSelf: "stretch",
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: R.xl,
    borderTopRightRadius: 44,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F3C9A6",
    ...shadow(2),
  },
  aiInner: { padding: 16 },
  aiHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    backgroundColor: C.brand,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  aiBadgeText: { color: "#FFFFFF", fontSize: 10.5, fontFamily: F.bodySemi, letterSpacing: 0.6 },
  aiTitle: { color: C.ink, fontSize: 19, fontFamily: F.display, marginTop: 6, letterSpacing: -0.3 },
  aiDesc: { color: C.inkSoft, fontSize: 12.5, fontFamily: F.body, lineHeight: 17, marginTop: 3 },
  sugRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: R.md,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  sugIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },
  sugText: { flex: 1, color: C.ink, fontSize: 14, fontFamily: F.bodyMedium },
  askBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.ink,
    borderRadius: R.md,
    paddingVertical: 13,
    marginTop: 12,
  },
  askText: { color: "#FFFFFF", fontSize: 14.5, fontFamily: F.bodySemi },

  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 18,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    borderRadius: R.xl,
    borderBottomLeftRadius: 40,
  },
  cardHeading: { color: "#FFFFFF", fontSize: 11.5, fontFamily: F.bodyMedium, letterSpacing: 1.2, opacity: 0.8 },
  cardTitle: { color: "#FFFFFF", fontSize: 20, fontFamily: F.displayMedium },
  cardSub: { color: "#FFFFFF", fontSize: 15, fontFamily: F.bodySemi, marginTop: 14 },
  cardSubInline: { color: "#FFFFFF", fontSize: 15, fontFamily: F.bodySemi },
  text: { color: "#FFFFFF", fontSize: 15, fontFamily: F.body, lineHeight: 22, marginTop: 6 },
  iconTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  bulletRow: { flexDirection: "row", marginTop: 6 },
  bulletDot: { color: "#FFFFFF", fontSize: 15, lineHeight: 22, width: 16 },
  bulletText: { color: "#FFFFFF", fontSize: 15, fontFamily: F.body, lineHeight: 22, flex: 1 },
  warningBox: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: "rgba(224, 83, 61, 0.25)" },
  unlockCard: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 18,
    borderRadius: R.xl,
    borderTopLeftRadius: 40,
    backgroundColor: "rgba(255,253,249,0.97)",
    borderWidth: 1,
    borderColor: "#F3C9A6",
    ...shadow(2),
  },
  unlockHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  unlockIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  unlockTitle: { fontSize: 18, fontFamily: F.display, color: C.ink, letterSpacing: -0.3 },
  unlockSub: { fontSize: 13, fontFamily: F.body, color: C.inkSoft, marginTop: 2 },
  unlockRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  unlockText: { fontSize: 14.5, fontFamily: F.bodyMedium, color: C.ink },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.brand,
    borderRadius: R.md,
    paddingVertical: 14,
    marginTop: 14,
  },
  unlockBtnText: { color: "#FFFFFF", fontSize: 15.5, fontFamily: F.bodySemi },
  unlockLink: { alignItems: "center", paddingVertical: 12 },
  unlockLinkText: { color: C.brandDeep, fontSize: 14, fontFamily: F.bodySemi },
  sourceNote: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontFamily: F.body,
    marginHorizontal: 22,
    marginTop: 8,
    lineHeight: 15,
  },
});
