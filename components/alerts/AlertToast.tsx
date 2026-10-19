import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInUp, SlideOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAlerts } from "../../context/alerts";
import { SEVERITY_STYLE } from "./severity";
import { useI18n } from "../../lib/i18n";
import { F, shadow } from "../ui/theme";

/** Drops in from the top when a new important alert appears, then hides itself. */
export default function AlertToast() {
  const { fresh, clearFresh } = useAlerts();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(clearFresh, 6000);
    return () => clearTimeout(t);
  }, [fresh, clearFresh]);

  if (!fresh) return null;
  const s = SEVERITY_STYLE[fresh.severity];

  return (
    <Animated.View
      key={fresh.id}
      entering={SlideInUp.springify().damping(16)}
      exiting={SlideOutUp.duration(250)}
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <Pressable
        style={[styles.toast, { borderColor: s.color }]}
        onPress={() => {
          clearFresh();
          router.push("/alerts");
        }}
        accessibilityRole="alert"
      >
        <View style={[styles.icon, { backgroundColor: s.color }]}>
          <Ionicons name={fresh.icon} size={18} color="#FFFFFF" />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.label, { color: s.color }]}>
            {t("NEW")} · {t(s.label)}
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {fresh.title}
          </Text>
          <Text style={styles.msg} numberOfLines={2}>
            {fresh.message}
          </Text>
        </View>
        <Pressable onPress={clearFresh} hitSlop={10} accessibilityLabel={t("Dismiss")}>
          <Ionicons name="close" size={18} color="#958778" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 100, alignItems: "center" },
  toast: {
    width: "100%",
    maxWidth: 560,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 12,
    ...shadow(3),
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  label: { fontSize: 10, fontFamily: F.bodySemi, letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 14.5, fontFamily: F.bodySemi, color: "#2B2320", marginTop: 1 },
  msg: { fontSize: 12.5, fontFamily: F.body, color: "#5E5148", marginTop: 2, lineHeight: 17 },
});
