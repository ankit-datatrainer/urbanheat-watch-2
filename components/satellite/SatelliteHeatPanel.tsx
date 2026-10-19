import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import SatelliteMap from "./SatelliteMap";
import PressableScale from "../ui/PressableScale";
import { C, F, R } from "../ui/theme";
import { useCity } from "../CityContext";
import { tx, useI18n } from "../../lib/i18n";
import {
  HEAT_LEGEND,
  fetchSatelliteLst,
  fetchSatellitePoint,
  formatSatDate,
  heatTileTemplate,
  type SatelliteResult,
} from "../../lib/satellite";

/** Satellite surface temperature for the current city, tagged with the city it belongs to. */
export function useCitySatellite() {
  const { city } = useCity();
  const [state, setState] = useState<{ cityId: string; data: SatelliteResult | null; error: string | null } | null>(
    null,
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const cityId = city.id;
    fetchSatelliteLst(city.lat, city.lon, 15, ctrl.signal)
      .then((data) => !ctrl.signal.aborted && setState({ cityId, data, error: null }))
      .catch(
        () =>
          !ctrl.signal.aborted && setState({ cityId, data: null, error: tx("Couldn't reach the satellite service.") }),
      );
    return () => ctrl.abort();
  }, [city.id, city.lat, city.lon]);

  const current = state?.cityId === city.id ? state : null;
  return { loading: !current, data: current?.data ?? null, error: current?.error ?? null };
}

function Legend() {
  const { t } = useI18n();
  return (
    <View>
      <LinearGradient
        colors={HEAT_LEGEND.map((s) => s.color) as unknown as readonly [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.legendBar}
      />
      <View style={styles.legendLabels}>
        <Text style={styles.legendText}>≤{HEAT_LEGEND[0]!.c}°</Text>
        <Text style={styles.legendText}>{t("Ground temperature")}</Text>
        <Text style={styles.legendText}>≥{HEAT_LEGEND[HEAT_LEGEND.length - 1]!.c}°</Text>
      </View>
    </View>
  );
}

type Props = { style?: StyleProp<ViewStyle>; zoom?: number };

/** Full-bleed satellite map with layer switch, source chip, stats and tap-to-read. */
export default function SatelliteHeatPanel({ style, zoom = 10 }: Props) {
  const { city } = useCity();
  const { t, locale } = useI18n();
  const { loading, data, error } = useCitySatellite();
  const [mode, setMode] = useState<"heat" | "photo">("heat");
  const [probe, setProbe] = useState<{ lat: number; lon: number; valueC: number | null; busy: boolean } | null>(null);

  const sat = data?.available ? data : null;
  const tiles = sat ? heatTileTemplate(sat.layerId, sat.date) : null;

  function onPress(lat: number, lon: number) {
    if (!sat || mode !== "heat") return;
    setProbe({ lat, lon, valueC: null, busy: true });
    fetchSatellitePoint(lat, lon, sat.layerId, sat.date)
      .then((r) => setProbe({ lat, lon, valueC: r.valueC, busy: false }))
      .catch(() => setProbe({ lat, lon, valueC: null, busy: false }));
  }

  return (
    <View style={[styles.wrap, style]}>
      <SatelliteMap
        key={city.id}
        lat={city.lat}
        lon={city.lon}
        zoom={zoom}
        mode={mode}
        heatTiles={tiles}
        hotspot={sat?.hotspot ?? null}
        onPressPoint={onPress}
        pin={probe ? { lat: probe.lat, lon: probe.lon } : null}
      />

      {/* Top: source and layer switch */}
      <View style={styles.topRow} pointerEvents="box-none">
        <Animated.View entering={FadeInDown.springify()} style={styles.sourceChip}>
          <Ionicons name="planet" size={13} color="#FFFFFF" />
          <Text style={styles.sourceText} numberOfLines={1}>
            {sat
              ? `${sat.source.replace(" via NASA GIBS", "")} · ${formatSatDate(sat.date, locale)}${sat.composite ? ` · ${t("8-day")}` : ""}`
              : t("Satellite")}
          </Text>
        </Animated.View>
        <View style={styles.toggle}>
          {(["heat", "photo"] as const).map((m) => (
            <PressableScale
              key={m}
              onPress={() => setMode(m)}
              style={[styles.toggleItem, mode === m && styles.toggleOn]}
            >
              <Ionicons
                name={m === "heat" ? "thermometer" : "earth"}
                size={13}
                color={mode === m ? C.ink : "#FFFFFF"}
              />
              <Text style={[styles.toggleText, mode === m && styles.toggleTextOn]}>
                {m === "heat" ? t("Heat") : t("Photo")}
              </Text>
            </PressableScale>
          ))}
        </View>
      </View>

      {/* Bottom: stats, legend, tap readout */}
      <Animated.View
        entering={FadeInUp.delay(150).springify().damping(18)}
        style={styles.bottom}
        pointerEvents="box-none"
      >
        {probe && (
          <Animated.View entering={FadeIn} style={styles.probe}>
            {probe.busy ? (
              <ActivityIndicator size="small" color={C.brand} />
            ) : (
              <Ionicons name="locate" size={15} color={C.brand} />
            )}
            <Text style={styles.probeText}>
              {probe.busy
                ? t("Reading satellite pixel…")
                : probe.valueC != null
                  ? t("Ground here: {v}°C", { v: probe.valueC.toFixed(1) })
                  : t("No clear satellite reading here (cloud or water)")}
            </Text>
          </Animated.View>
        )}
        <View style={styles.statsCard}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={C.brand} />
              <Text style={styles.statLabel}>{t("Loading satellite data…")}</Text>
            </View>
          ) : sat ? (
            <>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{sat.meanC != null ? `${Math.round(sat.meanC)}°` : "—"}</Text>
                  <Text style={styles.statLabel}>{t("Avg ground")}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.stat}>
                  <Text style={[styles.statValue, { color: C.high }]}>
                    {sat.maxC != null ? `${Math.round(sat.maxC)}°` : "—"}
                  </Text>
                  <Text style={styles.statLabel}>{t("Hottest spot")}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{sat.coveragePercent}%</Text>
                  <Text style={styles.statLabel}>{t("Clear view")}</Text>
                </View>
              </View>
              {mode === "heat" && <Legend />}
              <Text style={styles.hint}>{t("Tap the map to read the satellite temperature at any point.")}</Text>
            </>
          ) : (
            <Text style={styles.statLabel}>
              {error ? t(error) : t("No clear satellite observation of this area in the last month.")}
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const glass = "rgba(20,24,32,0.62)";

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#0E1A2B" },
  topRow: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  sourceChip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: glass,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sourceText: { color: "#FFFFFF", fontSize: 11.5, fontFamily: F.bodyMedium, flexShrink: 1 },
  toggle: { marginLeft: "auto", flexDirection: "row", backgroundColor: glass, borderRadius: R.pill, padding: 3 },
  toggleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: R.pill,
  },
  toggleOn: { backgroundColor: "#FFFFFF" },
  toggleText: { color: "#FFFFFF", fontSize: 12, fontFamily: F.bodyMedium },
  toggleTextOn: { color: C.ink },

  bottom: { position: "absolute", left: 10, right: 10, bottom: 22, gap: 8 },
  probe: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: R.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  probeText: { fontSize: 12.5, fontFamily: F.bodyMedium, color: C.ink },
  statsCard: { backgroundColor: "rgba(255,253,249,0.96)", borderRadius: R.lg, padding: 12, gap: 10 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontFamily: F.displayMedium, color: C.ink, letterSpacing: -0.4 },
  statLabel: { fontSize: 11.5, fontFamily: F.body, color: C.inkSoft, marginTop: 1, textAlign: "center" },
  divider: { width: 1, height: 28, backgroundColor: C.border },
  legendBar: { height: 7, borderRadius: 4 },
  legendLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  legendText: { fontSize: 10.5, fontFamily: F.body, color: C.inkMuted },
  hint: { fontSize: 11, fontFamily: F.body, color: C.inkMuted, textAlign: "center" },
});
