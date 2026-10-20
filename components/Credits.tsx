import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useT } from "../lib/i18n";
import { C, F } from "./ui/theme";

/** The people who created UrbanHeat Watch, shown on the splash screen and in Profile. */
export const CREATORS = ["Mary Katrina Xavier Mahendran"];

export default function Credits({ tone = "dark", style }: { tone?: "dark" | "light"; style?: StyleProp<ViewStyle> }) {
  const t = useT();
  const light = tone === "light";
  return (
    <View style={[styles.wrap, style]} accessibilityLabel={`${t("Created by")} ${CREATORS.join(", ")}`}>
      <View style={styles.labelRow}>
        <View style={[styles.rule, light && styles.ruleLight]} />
        <Text style={[styles.label, light && styles.labelLight]}>{t("Created by")}</Text>
        <View style={[styles.rule, light && styles.ruleLight]} />
      </View>
      {CREATORS.map((name) => (
        <Text key={name} style={[styles.name, light && styles.nameLight]}>
          {name}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 2 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  rule: { width: 22, height: 1, backgroundColor: C.borderStrong },
  ruleLight: { backgroundColor: "rgba(255,255,255,0.35)" },
  label: { fontSize: 10.5, fontFamily: F.bodySemi, color: C.inkMuted, letterSpacing: 1.6, textTransform: "uppercase" },
  labelLight: { color: "rgba(255,255,255,0.7)" },
  name: { fontSize: 14, fontFamily: F.displayMedium, color: C.ink, letterSpacing: -0.1 },
  nameLight: { color: "#FFFFFF" },
});
