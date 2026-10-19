import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/auth";
import { acceptInvite } from "../lib/family";
import { useT } from "../lib/i18n";
import AiMascot from "../components/ai/AiMascot";
import PressableScale from "../components/ui/PressableScale";
import { F, C, R, shadow } from "../components/ui/theme";

/** Opened from a family invite link: ecowatch://invite?code=XXXX&from=Name */
export default function InviteScreen() {
  const { code, from } = useLocalSearchParams<{ code?: string; from?: string }>();
  const { user } = useAuth();
  const t = useT();
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; message?: string }>({
    status: "idle",
  });
  const inviter = from ? String(from) : t("A family member");

  async function accept() {
    if (!user) {
      router.push({ pathname: "/login", params: { next: `/invite?code=${code ?? ""}` } });
      return;
    }
    setState({ status: "busy" });
    const res = await acceptInvite(String(code ?? ""));
    setState(res.ok ? { status: "done", message: res.message } : { status: "error", message: res.message });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <Animated.View entering={ZoomIn.springify().damping(12)}>
          <AiMascot size={150} mood={state.status === "done" ? "happy" : "idle"} halo />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(150).springify()} style={styles.title}>
          {state.status === "done" ? t("You're in the circle!") : t("{name} invited you", { name: inviter })}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(250).springify()} style={styles.sub}>
          {state.status === "done"
            ? (state.message ?? t("You'll now share heat alerts and check-ins with your family."))
            : t(
                "Join their family circle on UrbanHeat Watch to share heat alerts and check on each other on very hot days.",
              )}
        </Animated.Text>
        {code ? (
          <Animated.View entering={FadeInDown.delay(320).springify()} style={styles.codeBox}>
            <Text style={styles.codeLabel}>{t("INVITE CODE")}</Text>
            <Text style={styles.code}>{String(code)}</Text>
          </Animated.View>
        ) : null}
        {state.status === "error" && <Text style={styles.error}>{state.message ? t(state.message) : null}</Text>}

        <Animated.View entering={FadeInDown.delay(400).springify()} style={styles.actions}>
          {state.status !== "done" && code ? (
            <PressableScale onPress={accept} disabled={state.status === "busy"} style={styles.primary}>
              {state.status === "busy" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="people" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryText}>{user ? t("Accept invite") : t("Sign in to accept")}</Text>
                </>
              )}
            </PressableScale>
          ) : null}
          <PressableScale onPress={() => router.replace("/(tabs)/home")} style={styles.secondary}>
            <Text style={styles.secondaryText}>
              {state.status === "done" ? t("Open UrbanHeat Watch") : t("Maybe later")}
            </Text>
          </PressableScale>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 10,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 26, fontFamily: F.display, color: C.ink, textAlign: "center", marginTop: 12, letterSpacing: -0.5 },
  sub: { fontSize: 15, fontFamily: F.body, color: C.inkSoft, textAlign: "center", lineHeight: 22 },
  codeBox: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderStrong,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  codeLabel: { fontSize: 10, fontFamily: F.bodySemi, letterSpacing: 1.2, color: C.inkMuted },
  code: { fontSize: 24, fontFamily: F.display, letterSpacing: 4, color: C.ink },
  error: { color: C.high, fontFamily: F.bodySemi, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: 10, marginTop: 18 },
  primary: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.brand,
    borderRadius: R.md,
    paddingVertical: 15,
    ...shadow(2),
  },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontFamily: F.bodySemi },
  secondary: { alignItems: "center", paddingVertical: 14 },
  secondaryText: { color: C.inkSoft, fontFamily: F.bodySemi, fontSize: 15 },
});
