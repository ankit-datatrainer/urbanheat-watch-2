import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  Easing,
  FadeInDown,
  FadeOutLeft,
  LinearTransition,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCity } from "../../components/CityContext";
import { useAlerts } from "../../context/alerts";
import { useFamily } from "../../context/family";
import { NOTIFY_SEVERITIES, hourLabel, type AlertKind, type DynamicAlert } from "../../lib/alerts";
import { callPhone, forwardMessage, memberArea, shareVia, type FamilyMember } from "../../lib/family";
import { SEVERITY_STYLE } from "../../components/alerts/severity";
import { tx, useI18n } from "../../lib/i18n";
import ScreenHeader from "../../components/ui/ScreenHeader";
import PressableScale from "../../components/ui/PressableScale";
import Reveal from "../../components/ui/Reveal";
import { F, C, R, shadow } from "../../components/ui/theme";

const FILTERS: { key: "all" | AlertKind; label: string }[] = [
  { key: "all", label: tx("All") },
  { key: "heat", label: tx("Heat") },
  { key: "forecast", label: tx("Forecast") },
  { key: "uv", label: tx("UV") },
  { key: "air", label: tx("Air") },
  { key: "family", label: tx("Family") },
  { key: "tip", label: tx("Tips") },
];

function LivePulse({ color }: { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
  }, [p]);
  const ring = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ scale: 1 + p.value * 1.6 }] }));
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color }, ring]} />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

/** Alerts worth passing on to family: heat now, heat coming, and family checks. */
const FORWARDABLE: AlertKind[] = ["heat", "forecast", "family", "air"];

function AlertCard({
  alert,
  index,
  onDismiss,
  onCall,
  onMessage,
}: {
  alert: DynamicAlert;
  index: number;
  onDismiss: () => void;
  onCall?: () => void;
  onMessage?: () => void;
}) {
  const s = SEVERITY_STYLE[alert.severity];
  const { t } = useI18n();
  const shake = useSharedValue(0);
  useEffect(() => {
    if (alert.severity !== "critical") return;
    shake.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 70 }),
        withTiming(-1, { duration: 70 }),
        withTiming(1, { duration: 70 }),
        withTiming(0, { duration: 70 }),
        withTiming(0, { duration: 3200 }),
      ),
      -1,
      false,
    );
  }, [alert.severity, shake]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${shake.value * 10}deg` }] }));

  return (
    <Animated.View
      entering={FadeInDown.delay(80 + index * 70)
        .springify()
        .damping(18)}
      exiting={FadeOutLeft.duration(220)}
      layout={LinearTransition.springify().damping(18)}
      style={[styles.card, { backgroundColor: s.tint, borderColor: `${s.color}55` }]}
    >
      <View style={[styles.cardAccent, { backgroundColor: s.color }]} />
      <View style={styles.cardTop}>
        <Animated.View style={[styles.cardIcon, { backgroundColor: s.color }, iconStyle]}>
          <Ionicons name={alert.icon} size={18} color="#FFFFFF" />
        </Animated.View>
        <View style={styles.flex}>
          <View style={styles.labelRow}>
            <Text style={[styles.sevLabel, { color: s.color }]}>{t(s.label)}</Text>
            {(alert.severity === "critical" || alert.severity === "warning") && <LivePulse color={s.color} />}
          </View>
          <Text style={styles.cardTitle}>{alert.title}</Text>
        </View>
        {alert.severity !== "ok" && (
          <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel={t("Dismiss")} style={styles.close}>
            <Ionicons name="close" size={16} color={C.inkMuted} />
          </Pressable>
        )}
      </View>
      <Text style={styles.cardMsg}>{alert.message}</Text>
      {(onCall || onMessage) && (
        <View style={styles.contactRow}>
          {onCall && (
            <PressableScale onPress={onCall} style={[styles.contactBtn, { backgroundColor: C.info }]}>
              <Ionicons name="call" size={15} color="#FFFFFF" />
              <Text style={styles.contactText}>
                {alert.contact ? t("Call {name}", { name: alert.contact.name }) : t("Call family")}
              </Text>
            </PressableScale>
          )}
          {onMessage && (
            <PressableScale onPress={onMessage} style={[styles.contactBtn, { backgroundColor: "#25D366" }]}>
              <Ionicons name="chatbubble-ellipses" size={15} color="#FFFFFF" />
              <Text style={styles.contactText}>
                {alert.contact ? t("Message {name}", { name: alert.contact.name }) : t("Message family")}
              </Text>
            </PressableScale>
          )}
        </View>
      )}
      {alert.action && (
        <PressableScale
          style={[styles.cardAction, { borderColor: s.color }]}
          onPress={() =>
            router.push(
              alert.action!.query
                ? { pathname: alert.action!.route, params: { query: alert.action!.query } }
                : alert.action!.route,
            )
          }
        >
          <Text style={[styles.cardActionText, { color: s.color }]}>{alert.action.label}</Text>
          <Ionicons name="arrow-forward" size={14} color={s.color} />
        </PressableScale>
      )}
    </Animated.View>
  );
}

function ForecastStrip() {
  const { forecast } = useAlerts();
  const { t, locale } = useI18n();
  const hours = forecast?.hours.slice(0, 12) ?? [];
  if (!hours.length) return null;
  const max = Math.max(...hours.map((h) => h.wbgt), 33);
  const min = Math.min(...hours.map((h) => h.wbgt), 24);
  const colour = { Low: C.low, Moderate: C.moderate, High: C.high } as const;
  return (
    <Reveal index={1} style={styles.forecastCard}>
      <View style={styles.forecastHead}>
        <Text style={styles.sectionTitle}>{t("Next 12 hours")}</Text>
        <Text style={styles.mutedSmall}>{t("Estimated WBGT °C")}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bars}>
        {hours.map((h, i) => {
          const pct = (h.wbgt - min) / Math.max(1, max - min);
          return (
            <Animated.View key={h.time} entering={FadeInDown.delay(150 + i * 40).springify()} style={styles.barCol}>
              <Text style={styles.barValue}>{Math.round(h.wbgt)}</Text>
              <View style={styles.barTrack}>
                <LinearGradient
                  colors={[colour[h.band], `${colour[h.band]}88`]}
                  style={[styles.barFill, { height: `${18 + pct * 82}%` }]}
                />
              </View>
              <Text style={styles.barHour}>{i === 0 ? t("Now") : hourLabel(h.time, locale).replace(" ", "")}</Text>
              {h.rain >= 60 && <Ionicons name="rainy" size={11} color={C.info} />}
            </Animated.View>
          );
        })}
      </ScrollView>
    </Reveal>
  );
}

export default function AlertsScreen() {
  const { t, locale } = useI18n();
  const { city } = useCity();
  const {
    alerts,
    heat,
    air,
    loading,
    refreshing,
    updatedAt,
    refresh,
    markAllSeen,
    dismiss,
    dismissedCount,
    restoreDismissed,
  } = useAlerts();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const { members } = useFamily();
  const [forward, setForward] = useState<{ alert: DynamicAlert; mode: "call" | "message" } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2400);
  };

  async function call(m: FamilyMember) {
    setForward(null);
    if (!m.phone || !(await callPhone(m.phone))) showToast(t("Calling isn't available on this device"));
  }

  async function message(a: DynamicAlert, m: FamilyMember) {
    setForward(null);
    const res = await shareVia("whatsapp", forwardMessage(m.name, a.title, a.message, t), { phone: m.phone });
    showToast(
      res === "opened" ? t("Alert opened in WhatsApp for {name}", { name: m.name }) : t("Alert copied to clipboard"),
    );
  }

  async function shareOther(a: DynamicAlert) {
    setForward(null);
    const res = await shareVia("more", `${a.title}\n${a.message}\n\nUrbanHeat Watch`);
    if (res === "copied") showToast(t("Alert copied to clipboard"));
  }

  // Opening the tab counts as reading the alerts (clears the badge).
  useFocusEffect(
    useCallback(() => {
      markAllSeen();
    }, [markAllSeen]),
  );

  const shown = useMemo(() => (filter === "all" ? alerts : alerts.filter((a) => a.kind === filter)), [alerts, filter]);
  const active = alerts.filter(
    (a) => a.severity === "critical" || a.severity === "warning" || a.severity === "advisory",
  ).length;
  const top = alerts[0];
  const heroColors =
    top?.severity === "critical"
      ? (["#C7341F", "#E0533D", "#F07B2E"] as const)
      : top?.severity === "warning" || top?.severity === "advisory"
        ? (["#D9621A", "#F07B2E", "#F0A52E"] as const)
        : (["#1F7A60", "#2E9E7E", "#7DBF9C"] as const);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} />
        }
      >
        <ScreenHeader
          eyebrow={t("Live alerts")}
          title={t("Heat Alerts")}
          subtitle={t("Updated automatically for {city}. Pull down to refresh.", {
            city: `${t(city.name)}, ${t(city.country)}`,
          })}
          right={
            <PressableScale onPress={refresh} style={styles.refreshBtn} accessibilityLabel={t("Refresh alerts")}>
              {refreshing ? (
                <ActivityIndicator color={C.brand} size="small" />
              ) : (
                <Ionicons name="refresh" size={18} color={C.brand} />
              )}
            </PressableScale>
          }
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={C.brand} />
            <Text style={styles.mutedSmall}>{t("Checking conditions in {city}…", { city: t(city.name) })}</Text>
          </View>
        ) : (
          <>
            <Reveal index={0}>
              <LinearGradient colors={heroColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
                <View style={styles.heroRow}>
                  <View style={styles.flex}>
                    <Text style={styles.heroLabel}>{active ? t("ACTIVE ALERTS") : t("ALL CLEAR")}</Text>
                    <Text style={styles.heroCount}>{active}</Text>
                    <Text style={styles.heroSub}>
                      {updatedAt
                        ? t("Last checked {time}", {
                            time: new Date(updatedAt).toLocaleTimeString(locale, {
                              hour: "numeric",
                              minute: "2-digit",
                            }),
                          })
                        : t("Live")}
                    </Text>
                  </View>
                  <View style={styles.heroStats}>
                    <View style={styles.stat}>
                      <Ionicons name="thermometer" size={14} color="#FFFFFF" />
                      <Text style={styles.statText}>{heat ? `WBGT ${heat.wbgt}°` : "--"}</Text>
                    </View>
                    <View style={styles.stat}>
                      <Ionicons name="water" size={14} color="#FFFFFF" />
                      <Text style={styles.statText}>{heat ? `${heat.humidity}% ${t("RH")}` : "--"}</Text>
                    </View>
                    <View style={styles.stat}>
                      <Ionicons name="cloud" size={14} color="#FFFFFF" />
                      <Text style={styles.statText}>{air ? `AQI ${air.aqi}` : "AQI --"}</Text>
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </Reveal>

            <ForecastStrip />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {FILTERS.map((f) => {
                const count = f.key === "all" ? alerts.length : alerts.filter((a) => a.kind === f.key).length;
                const on = filter === f.key;
                return (
                  <PressableScale
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(f.label)}</Text>
                    {count > 0 && (
                      <View style={[styles.chipCount, on && styles.chipCountOn]}>
                        <Text style={[styles.chipCountText, on && { color: C.brand }]}>{count}</Text>
                      </View>
                    )}
                  </PressableScale>
                );
              })}
            </ScrollView>

            {shown.map((a, i) => {
              const forwardable =
                !!a.contact || (FORWARDABLE.includes(a.kind) && NOTIFY_SEVERITIES.includes(a.severity));
              const member = a.contact ? members.find((m) => m.id === a.contact!.memberId) : undefined;
              return (
                <AlertCard
                  key={a.id}
                  alert={a}
                  index={i}
                  onDismiss={() => dismiss(a.id)}
                  onCall={
                    !forwardable
                      ? undefined
                      : member
                        ? member.phone
                          ? () => call(member)
                          : undefined
                        : () => setForward({ alert: a, mode: "call" })
                  }
                  onMessage={
                    !forwardable
                      ? undefined
                      : member
                        ? () => message(a, member)
                        : () => setForward({ alert: a, mode: "message" })
                  }
                />
              );
            })}
            {shown.length === 0 && (
              <Animated.View entering={FadeInDown} style={styles.empty}>
                <Ionicons name="checkmark-done-circle" size={40} color={C.low} />
                <Text style={styles.emptyText}>{t("Nothing in this category right now.")}</Text>
              </Animated.View>
            )}
            {dismissedCount > 0 && (
              <Pressable onPress={restoreDismissed} style={styles.restore}>
                <Text style={styles.restoreText}>{t("Show dismissed alerts ({n})", { n: dismissedCount })}</Text>
              </Pressable>
            )}

            <Reveal index={3} style={styles.infoCard}>
              <View style={styles.infoHead}>
                <Ionicons name="school" size={17} color={C.brand} />
                <Text style={styles.sectionTitle}>{t("School advisory protocol")}</Text>
              </View>
              {[
                { c: C.low, t: tx("Green (WBGT < 31°C)"), d: tx("Normal outdoor activities.") },
                {
                  c: C.moderate,
                  t: tx("Orange (31.0 – 32.9°C)"),
                  d: tx("15 minutes of shaded rest per 45 minutes of activity."),
                },
                { c: C.high, t: tx("Red (≥ 33.0°C)"), d: tx("Postpone or suspend strenuous outdoor training.") },
              ].map((b) => (
                <View key={b.t} style={styles.bandRow}>
                  <View style={[styles.bandDot, { backgroundColor: b.c }]} />
                  <Text style={styles.infoText}>
                    <Text style={styles.bold}>{t(b.t)}: </Text>
                    {t(b.d)}
                  </Text>
                </View>
              ))}
            </Reveal>
          </>
        )}
      </ScrollView>

      {toast && (
        <Animated.View entering={FadeInDown.springify()} style={styles.toast} pointerEvents="none">
          <Ionicons name="information-circle" size={16} color="#FFFFFF" />
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      )}

      <Modal visible={forward !== null} transparent animationType="fade" onRequestClose={() => setForward(null)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setForward(null)} accessibilityLabel={t("Close")} />
          {forward && (
            <Animated.View entering={SlideInDown.springify().damping(18)} style={styles.sheet}>
              <View style={styles.grabber} />
              <Text style={styles.sheetTitle}>
                {forward.mode === "call" ? t("Call a family member") : t("Send this alert to family")}
              </Text>
              <Text style={styles.sheetSub} numberOfLines={2}>
                {forward.alert.title}
              </Text>
              {members.length === 0 ? (
                <Text style={styles.sheetEmpty}>
                  {t("Add family members in the Family tab to call or message them from here.")}
                </Text>
              ) : (
                members.map((m) => (
                  <View key={m.id} style={styles.memberRow}>
                    <View style={styles.flex}>
                      <Text style={styles.memberName}>{m.name}</Text>
                      <Text style={styles.memberMeta} numberOfLines={1}>
                        {t(m.relation)} · {t(memberArea(m, city).name)}
                      </Text>
                    </View>
                    {m.phone ? (
                      <PressableScale
                        onPress={() => call(m)}
                        style={[styles.roundBtn, { backgroundColor: C.info }]}
                        accessibilityLabel={t("Call {name}", { name: m.name })}
                      >
                        <Ionicons name="call" size={17} color="#FFFFFF" />
                      </PressableScale>
                    ) : (
                      <Text style={styles.noPhone}>{t("No phone")}</Text>
                    )}
                    <PressableScale
                      onPress={() => message(forward.alert, m)}
                      style={[styles.roundBtn, { backgroundColor: "#25D366" }]}
                      accessibilityLabel={t("Message {name}", { name: m.name })}
                    >
                      <Ionicons name="logo-whatsapp" size={17} color="#FFFFFF" />
                    </PressableScale>
                  </View>
                ))
              )}
              {forward.mode === "message" && (
                <PressableScale onPress={() => shareOther(forward.alert)} style={styles.otherBtn}>
                  <Ionicons name="share-social" size={16} color={C.brand} />
                  <Text style={styles.otherText}>{t("Share another way")}</Text>
                </PressableScale>
              )}
              <Pressable onPress={() => setForward(null)} style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>{t("Close")}</Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { padding: 20, paddingBottom: 120, width: "100%", maxWidth: 760, alignSelf: "center" },
  flex: { flex: 1 },
  loading: { alignItems: "center", gap: 10, paddingVertical: 60 },
  mutedSmall: { fontSize: 12, color: C.inkMuted, fontFamily: F.bodySemi },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  hero: { borderRadius: R.xl, borderTopRightRadius: 44, padding: 20, ...shadow(3) },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: F.bodySemi, letterSpacing: 1.4 },
  heroCount: { color: "#FFFFFF", fontSize: 56, fontFamily: F.displayThin, lineHeight: 62 },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: F.bodySemi },
  heroStats: { gap: 8 },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statText: { color: "#FFFFFF", fontSize: 12, fontFamily: F.bodySemi },

  forecastCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.border,
    ...shadow(1),
  },
  forecastHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontFamily: F.bodySemi, color: C.ink },
  bars: { gap: 10, paddingRight: 6 },
  barCol: { alignItems: "center", width: 34, gap: 4 },
  barValue: { fontSize: 11, fontFamily: F.bodySemi, color: C.inkSoft },
  barTrack: {
    height: 80,
    width: 14,
    borderRadius: 7,
    backgroundColor: C.bgDeep,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { width: "100%", borderRadius: 7 },
  barHour: { fontSize: 10, color: C.inkMuted, fontFamily: F.bodySemi },

  filters: { gap: 8, paddingVertical: 16 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { fontSize: 13, fontFamily: F.bodySemi, color: C.inkSoft },
  chipTextOn: { color: "#FFFFFF" },
  chipCount: { backgroundColor: C.bgDeep, borderRadius: 8, paddingHorizontal: 6, minWidth: 18, alignItems: "center" },
  chipCountOn: { backgroundColor: "#FFFFFF" },
  chipCountText: { fontSize: 11, fontFamily: F.bodySemi, color: C.inkSoft },

  card: { borderRadius: R.lg, padding: 16, paddingLeft: 20, marginBottom: 12, borderWidth: 1, overflow: "hidden" },
  cardAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sevLabel: { fontSize: 10.5, fontFamily: F.bodySemi, letterSpacing: 1.2, textTransform: "uppercase" },
  cardTitle: { fontSize: 16, fontFamily: F.bodySemi, color: C.ink, marginTop: 1 },
  close: { padding: 4 },
  cardMsg: { fontSize: 14, fontFamily: F.body, color: C.inkSoft, lineHeight: 20, marginTop: 10 },
  cardAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderRadius: R.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 12,
    backgroundColor: "#FFFFFF",
  },
  cardActionText: { fontSize: 13, fontFamily: F.bodySemi },
  contactRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  contactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: R.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  contactText: { color: "#FFFFFF", fontSize: 13, fontFamily: F.bodySemi },

  toast: {
    position: "absolute",
    bottom: 110,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.ink,
    borderRadius: R.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: "90%",
    ...shadow(3),
  },
  toastText: { color: "#FFFFFF", fontSize: 13, fontFamily: F.bodySemi },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,12,8,0.5)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 30,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.borderStrong,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 19, fontFamily: F.display, color: C.ink, textAlign: "center" },
  sheetSub: { fontSize: 13, fontFamily: F.body, color: C.inkSoft, textAlign: "center", marginTop: 4, marginBottom: 10 },
  sheetEmpty: { fontSize: 14, fontFamily: F.body, color: C.inkSoft, textAlign: "center", lineHeight: 20, marginTop: 8 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  memberName: { fontSize: 15, fontFamily: F.bodySemi, color: C.ink },
  memberMeta: { fontSize: 12, fontFamily: F.body, color: C.inkMuted, marginTop: 1 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  noPhone: { fontSize: 11.5, fontFamily: F.body, color: C.inkMuted },
  otherBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
    backgroundColor: C.brandTint,
    borderRadius: R.md,
    paddingVertical: 12,
  },
  otherText: { color: C.brand, fontSize: 14, fontFamily: F.bodySemi },
  sheetClose: { alignSelf: "center", padding: 12, marginTop: 4 },
  sheetCloseText: { color: C.inkMuted, fontFamily: F.bodySemi },
  pulseWrap: { width: 10, height: 10, alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", width: 10, height: 10, borderRadius: 5 },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },

  empty: { alignItems: "center", gap: 8, paddingVertical: 30 },
  emptyText: { color: C.inkSoft, fontSize: 14, fontFamily: F.bodySemi },
  restore: { alignSelf: "center", paddingVertical: 8 },
  restoreText: { color: C.brand, fontFamily: F.bodySemi, fontSize: 13 },

  infoCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 8,
  },
  infoHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  bandRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 6 },
  bandDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  infoText: { flex: 1, fontSize: 13.5, fontFamily: F.body, color: C.inkSoft, lineHeight: 20 },
  bold: { fontFamily: F.bodySemi, color: C.ink },
});
