import { Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import SatelliteHeatPanel from "../../components/satellite/SatelliteHeatPanel";
import CityPicker from "../../components/CityPicker";
import LanguageButton from "../../components/LanguagePicker";
import Reveal from "../../components/ui/Reveal";
import { C, F, R, shadow } from "../../components/ui/theme";
import { useT } from "../../lib/i18n";

/** Full-screen satellite heat map: NASA MODIS ground temperature over satellite imagery. */
export default function HeatmapScreen() {
  const t = useT();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Reveal index={0} style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{t("Satellite")}</Text>
          <Text style={styles.title}>{t("Heat map")}</Text>
        </View>
        <CityPicker tone="dark" />
        <LanguageButton />
      </Reveal>
      <Reveal index={1} style={styles.mapCard}>
        <SatelliteHeatPanel style={styles.flex} zoom={9} />
      </Reveal>
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={14} color={C.inkMuted} />
        <Text style={styles.noteText}>
          {t(
            "Ground (land-surface) temperature measured by NASA's Terra and Aqua satellites. Roofs and roads run hotter than the air.",
          )}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Native tab bars float over content; the web tab bar takes its own space.
  safe: { flex: 1, backgroundColor: C.bg, paddingBottom: Platform.OS === "web" ? 10 : 76 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  eyebrow: { fontSize: 11.5, fontFamily: F.bodySemi, color: C.brand, letterSpacing: 1.3, textTransform: "uppercase" },
  title: { fontSize: 26, fontFamily: F.display, color: C.ink, letterSpacing: -0.6 },
  mapCard: { flex: 1, marginHorizontal: 12, borderRadius: R.xl, overflow: "hidden", ...shadow(2) },
  note: { flexDirection: "row", gap: 6, paddingHorizontal: 18, paddingTop: 8, alignItems: "flex-start" },
  noteText: { flex: 1, fontSize: 11.5, fontFamily: F.body, color: C.inkMuted, lineHeight: 16 },
});
