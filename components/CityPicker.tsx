import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { ASEAN_CITIES } from "./aseanCities";
import { useCity } from "./CityContext";
import { useI18n } from "../lib/i18n";
import PressableScale from "./ui/PressableScale";
import { C, F, R, shadow } from "./ui/theme";

const COUNTRIES = [...new Set(ASEAN_CITIES.map((c) => c.country))].sort();

/** Small "📍 City ▾" chip that opens a country + city sheet. */
export default function CityPicker({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { city, setCity } = useCity();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(city.country);
  const light = tone === "light";

  return (
    <>
      <PressableScale
        onPress={() => {
          setCountry(city.country);
          setOpen(true);
        }}
        style={[styles.chip, light ? styles.chipLight : styles.chipDark]}
        accessibilityLabel={t("Change city")}
      >
        <Ionicons name="location" size={14} color={light ? "#FFFFFF" : C.brand} />
        <Text style={[styles.chipText, { color: light ? "#FFFFFF" : C.ink }]} numberOfLines={1}>
          {t(city.name)}
        </Text>
        <Ionicons name="chevron-down" size={13} color={light ? "rgba(255,255,255,0.85)" : C.inkMuted} />
      </PressableScale>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Animated.View entering={FadeIn} style={StyleSheet.absoluteFill}>
            <Pressable style={styles.backdropPress} onPress={() => setOpen(false)} accessibilityLabel={t("Close")} />
          </Animated.View>
          <Animated.View entering={SlideInDown.springify().damping(18)} style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{t("Choose a city")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.countries}>
              {COUNTRIES.map((c) => (
                <PressableScale
                  key={c}
                  onPress={() => setCountry(c)}
                  style={[styles.country, c === country && styles.countryOn]}
                >
                  <Text style={[styles.countryText, c === country && styles.countryTextOn]}>{t(c)}</Text>
                </PressableScale>
              ))}
            </ScrollView>
            <ScrollView style={styles.list}>
              {ASEAN_CITIES.filter((c) => c.country === country).map((c) => {
                const on = c.id === city.id;
                return (
                  <PressableScale
                    key={c.id}
                    scaleTo={0.98}
                    onPress={() => {
                      setCity(c);
                      setOpen(false);
                    }}
                    style={[styles.row, on && styles.rowOn]}
                  >
                    <Ionicons name={on ? "location" : "location-outline"} size={17} color={on ? C.brand : C.inkMuted} />
                    <Text style={[styles.rowText, on && { color: C.brandDeep }]}>{t(c.name)}</Text>
                    {on && <Ionicons name="checkmark" size={18} color={C.brand} />}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: R.pill,
    maxWidth: 210,
  },
  chipLight: { backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  chipDark: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  chipText: { fontSize: 14, fontFamily: F.bodySemi, flexShrink: 1 },

  backdrop: { flex: 1, justifyContent: "flex-end" },
  backdropPress: { flex: 1, backgroundColor: "rgba(20,12,8,0.5)" },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: "80%",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    ...shadow(3),
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.borderStrong,
    alignSelf: "center",
    marginBottom: 12,
  },
  title: { fontSize: 21, fontFamily: F.display, color: C.ink, paddingHorizontal: 20, marginBottom: 12 },
  countries: { gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  country: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  countryOn: { backgroundColor: C.ink, borderColor: C.ink },
  countryText: { fontSize: 13, fontFamily: F.bodyMedium, color: C.inkSoft },
  countryTextOn: { color: "#FFFFFF" },
  list: { paddingHorizontal: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: R.md,
    backgroundColor: C.surface,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowOn: { borderColor: C.brand, backgroundColor: C.brandTint },
  rowText: { flex: 1, fontSize: 15, fontFamily: F.bodyMedium, color: C.ink },
});
