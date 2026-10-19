import { useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../context/auth";
import { useFamily } from "../../context/family";
import { useAlerts } from "../../context/alerts";
import { useCity } from "../../components/CityContext";
import { LANGUAGES, useI18n } from "../../lib/i18n";
import LanguageButton from "../../components/LanguagePicker";
import AiMascot from "../../components/ai/AiMascot";
import Credits from "../../components/Credits";
import PressableScale from "../../components/ui/PressableScale";
import Reveal from "../../components/ui/Reveal";
import { F, C, R, shadow } from "../../components/ui/theme";

type IconName = keyof typeof Ionicons.glyphMap;
function MenuItem({
  icon,
  color,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  color: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={styles.menuItem}>
      <View style={[styles.menuIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={18} color="#FFFFFF" />
      </View>
      <View style={styles.flex}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.inkMuted} />
    </PressableScale>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { t, lang } = useI18n();
  const { members } = useFamily();
  const { alerts, unread } = useAlerts();
  const { city } = useCity();
  const fullName = (user?.user_metadata?.full_name as string | undefined)?.trim();
  const [loggingOut, setLoggingOut] = useState(false);
  const displayName = fullName || (user?.email ? user.email.split("@")[0] : "");

  async function performLogout() {
    setLoggingOut(true);
    try {
      await signOut();
    } finally {
      setLoggingOut(false);
      router.replace("/login");
    }
  }

  function handleLogout() {
    // Alert.alert buttons are not supported on web, so use the browser's confirm dialog there.
    if (Platform.OS === "web") {
      if (window.confirm(t("Are you sure you want to sign out?"))) performLogout();
      return;
    }
    Alert.alert(t("Sign out"), t("Are you sure you want to sign out?"), [
      { text: t("Cancel"), style: "cancel" },
      { text: t("Sign out"), style: "destructive", onPress: performLogout },
    ]);
  }

  const go = (href: Href) => () => router.push(href);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator>
        <Reveal index={0}>
          <LinearGradient
            colors={["#2B2320", "#4A3A30", "#7A5A44"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroBlob} />
            <View style={styles.heroRow}>
              <LinearGradient colors={["#F59A4A", "#E2621B"]} style={styles.avatar}>
                <Text style={styles.avatarText}>{(displayName || "U").charAt(0).toUpperCase()}</Text>
              </LinearGradient>
              <View style={styles.flex}>
                <Text style={styles.userName}>{displayName}</Text>
                <Text style={styles.userEmail}>{user?.email}</Text>
                <View style={styles.statusBadge}>
                  <View style={[styles.dot, { backgroundColor: C.leafLight }]} />
                  <Text style={styles.statusBadgeText}>{t("Signed in")}</Text>
                </View>
              </View>
            </View>
            <View style={styles.heroStats}>
              {[
                { n: members.length, l: t("Family") },
                { n: unread, l: t("New alerts") },
                { n: alerts.length, l: t("Live alerts") },
              ].map((s) => (
                <View key={s.l} style={styles.heroStat}>
                  <Text style={styles.heroStatNum}>{s.n}</Text>
                  <Text style={styles.heroStatLabel}>{s.l}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </Reveal>

        <Reveal index={1}>
          <PressableScale onPress={go("/ai")} scaleTo={0.98} style={styles.aiCard}>
            <AiMascot size={70} />
            <View style={styles.flex}>
              <Text style={styles.aiEyebrow}>{t("YOUR AI ASSISTANT")}</Text>
              <Text style={styles.aiTitle}>{t("Ask UrbanHeat Watch AI")}</Text>
              <Text style={styles.aiSub}>
                {t("Heat, hydration and climate answers for {city}", { city: t(city.name) })}
              </Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={30} color={C.brand} />
          </PressableScale>
        </Reveal>

        <Reveal index={2}>
          <Text style={styles.sectionTitle}>{t("Quick actions")}</Text>
          <MenuItem
            icon="notifications"
            color={C.high}
            title={t("Heat alerts")}
            subtitle={t("{n} live for {city}", { n: alerts.length, city: t(city.name) })}
            onPress={go("/alerts")}
          />
          <MenuItem
            icon="people"
            color={C.leaf}
            title={t("Family circle")}
            subtitle={t("Invite by WhatsApp, email or link")}
            onPress={go("/family")}
          />
          <MenuItem
            icon="map"
            color={C.info}
            title={t("Heat map")}
            subtitle={t("Satellite ground temperature by area")}
            onPress={go("/heatmap")}
          />
          <View style={styles.menuItem}>
            <View style={[styles.menuIcon, { backgroundColor: C.violet }]}>
              <Ionicons name="language" size={18} color="#FFFFFF" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.menuTitle}>{t("Language")}</Text>
              <Text style={styles.menuSub}>{LANGUAGES.find((l) => l.code === lang)?.native}</Text>
            </View>
            <LanguageButton />
          </View>
        </Reveal>

        <Reveal index={3}>
          <PressableScale
            style={[styles.logoutButton, loggingOut && styles.buttonDisabled]}
            onPress={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={styles.row}>
                <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
                <Text style={styles.logoutText}>{t("Sign out")}</Text>
              </View>
            )}
          </PressableScale>
          <View style={styles.creditsCard}>
            <Credits />
          </View>
          <Text style={styles.version}>UrbanHeat Watch · v1.0.0</Text>
        </Reveal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { padding: 20, paddingBottom: 120, width: "100%", maxWidth: 760, alignSelf: "center" },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },

  hero: { borderRadius: R.xl, borderBottomRightRadius: 52, padding: 20, overflow: "hidden", ...shadow(3) },
  heroBlob: {
    position: "absolute",
    right: -40,
    top: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(240,123,46,0.25)",
  },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.3)",
  },
  avatarText: { color: "#FFFFFF", fontSize: 26, fontFamily: F.display },
  userName: { fontSize: 21, fontFamily: F.display, color: "#FFFFFF", letterSpacing: -0.3 },
  userEmail: { fontSize: 13, fontFamily: F.body, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: R.pill,
    marginTop: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusBadgeText: { fontSize: 11.5, fontFamily: F.bodySemi, color: "#FFFFFF" },
  heroStats: {
    flexDirection: "row",
    marginTop: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: R.md,
    paddingVertical: 12,
  },
  heroStat: { flex: 1, alignItems: "center" },
  heroStatNum: { color: "#FFFFFF", fontSize: 22, fontFamily: F.display },
  heroStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11.5, fontFamily: F.bodySemi, marginTop: 2 },

  aiCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surfaceWarm,
    borderRadius: R.xl,
    borderTopLeftRadius: 40,
    borderWidth: 1.5,
    borderColor: "#F3C9A6",
    padding: 14,
    marginTop: 16,
    ...shadow(1),
  },
  aiEyebrow: { fontSize: 10.5, fontFamily: F.bodySemi, color: C.brand, letterSpacing: 1.2 },
  aiTitle: { fontSize: 17, fontFamily: F.bodySemi, color: C.ink, marginTop: 2 },
  aiSub: { fontSize: 12.5, fontFamily: F.body, color: C.inkSoft, marginTop: 2 },

  sectionTitle: {
    fontSize: 13,
    fontFamily: F.bodySemi,
    color: C.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 24,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: R.md,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  menuIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle: { fontSize: 15.5, fontFamily: F.bodySemi, color: C.ink },
  menuSub: { fontSize: 12.5, fontFamily: F.body, color: C.inkMuted, marginTop: 1 },

  logoutButton: {
    backgroundColor: C.high,
    borderRadius: R.md,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    ...shadow(2),
  },
  buttonDisabled: { opacity: 0.6 },
  logoutText: { color: "#FFFFFF", fontSize: 16, fontFamily: F.bodySemi },
  creditsCard: {
    marginTop: 24,
    paddingVertical: 18,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  version: { textAlign: "center", color: C.inkMuted, fontSize: 12, fontFamily: F.body, marginTop: 14 },
});
