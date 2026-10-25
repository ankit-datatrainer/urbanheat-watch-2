import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutLeft,
  LinearTransition,
  SlideInDown,
  ZoomIn,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCity } from "../../components/CityContext";
import { ASEAN_CITIES, type City } from "../../components/aseanCities";
import { useAuth } from "../../context/auth";
import { useFamily } from "../../context/family";
import { useAlerts } from "../../context/alerts";
import { tx, useI18n, type TFunction } from "../../lib/i18n";
import {
  RELATIONS,
  callPhone,
  inviteLink,
  inviteMessage,
  isVulnerable,
  memberArea,
  reminderMessage,
  shareVia,
  type FamilyMember,
  type Relation,
  type ShareChannel,
} from "../../lib/family";
import type { HeatBand } from "../../lib/heat";
import ScreenHeader from "../../components/ui/ScreenHeader";
import PressableScale from "../../components/ui/PressableScale";
import Reveal from "../../components/ui/Reveal";
import { F, C, R, shadow } from "../../components/ui/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const CHANNELS: { key: ShareChannel; label: string; icon: IconName; color: string }[] = [
  { key: "whatsapp", label: tx("WhatsApp"), icon: "logo-whatsapp", color: "#25D366" },
  { key: "email", label: tx("Email"), icon: "mail", color: "#3F87D9" },
  { key: "sms", label: tx("SMS"), icon: "chatbubble-ellipses", color: "#7B5CF0" },
  { key: "more", label: tx("More"), icon: "share-social", color: C.brand },
  { key: "copy", label: tx("Copy"), icon: "copy", color: C.ink },
];

const AVATAR_COLORS: readonly [string, string][] = [
  ["#F59A4A", "#E2621B"],
  ["#7DBF9C", "#3E8A68"],
  ["#9B7BFF", "#5B3FD0"],
  ["#5FA8F0", "#2F6DB8"],
  ["#F28BA8", "#C9446B"],
];

function avatarColors(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Current time, refreshed every minute so "needs check" flags expire on their own. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function timeAgo(iso: string, t: TFunction) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return t("just now");
  if (mins < 60) return t("{n} min ago", { n: mins });
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? t("{n} h ago", { n: hrs }) : t("{n} d ago", { n: Math.round(hrs / 24) });
}

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  };
  // Inside the sheet the toast sits at the top so it never covers the sheet's buttons.
  const node = (atTop = false) =>
    toast ? (
      <Animated.View
        entering={FadeInDown.springify()}
        exiting={FadeOut}
        style={[styles.toast, atTop ? styles.toastTop : styles.toastBottom]}
        pointerEvents="none"
      >
        <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
        <Text style={styles.toastText}>{toast}</Text>
      </Animated.View>
    ) : null;
  return { show, node };
}

/* ---------------- Share sheet ---------------- */

function ShareSheet({
  member,
  inviter,
  onClose,
  onShared,
}: {
  member: FamilyMember;
  inviter: string;
  onClose: () => void;
  onShared: (msg: string) => void;
}) {
  const { city } = useCity();
  const { t } = useI18n();
  const message = inviteMessage(member, inviter, t(city.name), t);
  const link = inviteLink(member.inviteCode, inviter);

  async function send(channel: ShareChannel) {
    const res = await shareVia(channel, message, { email: member.email, phone: member.phone });
    if (res === "unavailable") onShared(t("Couldn't copy here. Select the invite code to copy it."));
    else if (res === "copied")
      onShared(
        channel === "copy" ? t("Invite copied to clipboard") : t("Couldn't open the app, so the invite was copied"),
      );
    else onShared(t("Invite opened in {app}", { app: t(CHANNELS.find((c) => c.key === channel)?.label ?? "") }));
  }

  return (
    <View style={styles.sheetBody}>
      <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.successBadge}>
        <Ionicons name="paper-plane" size={26} color="#FFFFFF" />
      </Animated.View>
      <Text style={styles.sheetTitle}>Invite {member.name}</Text>
      <Text style={styles.sheetSub}>
        Send the invite link by WhatsApp, email or any app. They join your circle with one tap.
      </Text>

      <View style={styles.linkBox}>
        <View style={styles.flex}>
          <Text style={styles.linkLabel}>{t("INVITE CODE")}</Text>
          <Text style={styles.code} selectable>
            {member.inviteCode}
          </Text>
          <Text style={styles.link} numberOfLines={1} selectable>
            {link}
          </Text>
        </View>
        <PressableScale onPress={() => send("copy")} style={styles.copyBtn} accessibilityLabel={t("Copy invite")}>
          <Ionicons name="copy-outline" size={18} color={C.brand} />
        </PressableScale>
      </View>

      <View style={styles.channels}>
        {CHANNELS.map((c, i) => (
          <Animated.View key={c.key} entering={FadeInDown.delay(80 + i * 60).springify()} style={styles.channelCol}>
            <PressableScale
              onPress={() => send(c.key)}
              style={[styles.channel, { backgroundColor: c.color }]}
              accessibilityLabel={t("Share via {app}", { app: t(c.label) })}
            >
              <Ionicons name={c.icon} size={24} color="#FFFFFF" />
            </PressableScale>
            <Text style={styles.channelLabel}>{t(c.label)}</Text>
          </Animated.View>
        ))}
      </View>

      <PressableScale onPress={onClose} style={styles.doneBtn}>
        <Text style={styles.doneText}>{t("Done")}</Text>
      </PressableScale>
    </View>
  );
}

/* ---------------- Add member form ---------------- */

/** Search the app's cities and pick the one the member lives in. */
function AreaPicker({ value, onChange }: { value: City; onChange: (c: City) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? ASEAN_CITIES.filter((c) => `${t(c.name)} ${c.name} ${t(c.country)} ${c.country}`.toLowerCase().includes(q)).slice(
        0,
        6,
      )
    : [];
  return (
    <View>
      <View style={styles.inputWrap}>
        <Ionicons name="location-outline" size={18} color={C.brand} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("{city}, {country}", { city: t(value.name), country: t(value.country) })}
          placeholderTextColor={C.ink}
          style={styles.input}
          accessibilityLabel={t("City or area")}
        />
      </View>
      {matches.length > 0 && (
        <View style={styles.areaList}>
          {matches.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                onChange(c);
                setQuery("");
              }}
              style={styles.areaRow}
            >
              <Text style={styles.areaCity}>{t(c.name)}</Text>
              <Text style={styles.areaCountry}>{t(c.country)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function AddMemberForm({ onCreated, onCancel }: { onCreated: (m: FamilyMember) => void; onCancel: () => void }) {
  const { add } = useFamily();
  const { city } = useCity();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<Relation>("Parent");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState<City>(city);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = name.trim();
    if (!n) return setError(t("Please enter a name."));
    if (!address.trim()) return setError(t("Please enter their address."));
    if (phone.trim() && phone.replace(/[^\d]/g, "").length < 7)
      return setError(t("Include the full phone number with country code."));
    setError(null);
    setSaving(true);
    try {
      const m = await add({
        name: n,
        relation,
        address: address.trim().slice(0, 200),
        areaId: area.id,
        phone: phone.trim() || null,
      });
      onCreated(m);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
      <Text style={styles.sheetTitle}>{t("Add family member")}</Text>
      <Text style={styles.sheetSub}>
        We&apos;ll create a personal invite link you can send by WhatsApp, email or SMS.
      </Text>

      <Text style={styles.fieldLabel}>{t("Name")}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name="person-outline" size={18} color={C.inkMuted} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("e.g. Grandma Mei")}
          placeholderTextColor={C.inkMuted}
          style={styles.input}
          autoFocus
        />
      </View>

      <Text style={styles.fieldLabel}>{t("Relationship")}</Text>
      <View style={styles.relations}>
        {RELATIONS.map((r) => {
          const on = r === relation;
          return (
            <PressableScale
              key={r}
              onPress={() => setRelation(r)}
              style={[styles.relChip, on && styles.relChipOn]}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.relText, on && styles.relTextOn]}>{t(r)}</Text>
            </PressableScale>
          );
        })}
      </View>
      {isVulnerable({ relation }) && (
        <Animated.View entering={FadeIn} style={styles.vulnNote}>
          <Ionicons name="heart" size={14} color={C.high} />
          <Text style={styles.vulnText}>{t("We'll remind you to check on them on hot days.")}</Text>
        </Animated.View>
      )}

      <Text style={styles.fieldLabel}>{t("Address")}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name="home-outline" size={18} color={C.inkMuted} />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder={t("e.g. Jl. Sudirman 12, Tanah Abang")}
          placeholderTextColor={C.inkMuted}
          style={styles.input}
          maxLength={200}
        />
      </View>

      <Text style={styles.fieldLabel}>{t("City or area (for their heat alerts)")}</Text>
      <AreaPicker value={area} onChange={setArea} />

      <Text style={styles.fieldLabel}>{t("Phone for Call and Message (optional)")}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name="call-outline" size={18} color={C.leaf} />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="+62 812 3456 7890"
          placeholderTextColor={C.inkMuted}
          keyboardType="phone-pad"
          style={styles.input}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <PressableScale onPress={submit} disabled={saving} style={[styles.primaryBtn, saving && { opacity: 0.7 }]}>
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="link" size={18} color="#FFFFFF" />
            <Text style={styles.primaryText}>{t("Create invite link")}</Text>
          </>
        )}
      </PressableScale>
      <Pressable onPress={onCancel} style={styles.cancel}>
        <Text style={styles.cancelText}>{t("Cancel")}</Text>
      </Pressable>
    </ScrollView>
  );
}

/* ---------------- Member card ---------------- */

const BAND_STYLE: Record<HeatBand, { color: string; tint: string; label: string }> = {
  Low: { color: C.low, tint: C.lowTint, label: tx("Low heat stress") },
  Moderate: { color: "#B9770E", tint: C.moderateTint, label: tx("Moderate heat stress") },
  High: { color: C.high, tint: C.highTint, label: tx("High heat stress") },
};

function MemberCard({
  member,
  index,
  needsCheck,
  areaName,
  band,
  onRemind,
  onCall,
  onInvite,
  onCheckIn,
  onRemove,
}: {
  member: FamilyMember;
  index: number;
  needsCheck: boolean;
  areaName: string;
  band: HeatBand | null;
  onRemind: () => void;
  onCall: () => void;
  onInvite: () => void;
  onCheckIn: () => void;
  onRemove: () => void;
}) {
  const colors = avatarColors(member.name);
  const { t } = useI18n();
  return (
    <Animated.View
      entering={FadeInDown.delay(100 + index * 70)
        .springify()
        .damping(18)}
      exiting={FadeOutLeft.duration(220)}
      layout={LinearTransition.springify().damping(18)}
      style={[styles.memberCard, needsCheck && styles.memberCardAlert]}
    >
      <View style={styles.memberTop}>
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
          <Text style={styles.avatarText}>{member.name.charAt(0).toUpperCase()}</Text>
          <View style={[styles.presence, { backgroundColor: member.status === "joined" ? C.low : C.moderate }]} />
        </LinearGradient>
        <View style={styles.flex}>
          <Text style={styles.name}>{member.name}</Text>
          <View style={styles.tags}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{member.relation}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: member.status === "joined" ? C.lowTint : C.moderateTint }]}>
              <Text style={[styles.tagText, { color: member.status === "joined" ? C.low : "#B9770E" }]}>
                {member.status === "joined" ? t("Joined") : t("Invite pending")}
              </Text>
            </View>
            {needsCheck && (
              <View style={[styles.tag, { backgroundColor: C.highTint }]}>
                <Text style={[styles.tagText, { color: C.high }]}>{t("Needs check")}</Text>
              </View>
            )}
          </View>
          <Text style={styles.checkedIn}>
            {member.lastCheckIn
              ? t("Checked in {ago}", { ago: timeAgo(member.lastCheckIn, t) })
              : t("Not checked in yet")}
          </Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={t("Remove {name}", { name: member.name })}>
          <Ionicons name="trash-outline" size={18} color={C.inkMuted} />
        </Pressable>
      </View>
      <View style={styles.addressRow}>
        <Ionicons name="location" size={14} color={C.brand} />
        <Text style={styles.addressText} numberOfLines={2}>
          {member.address ? `${member.address} · ${t(areaName)}` : t(areaName)}
        </Text>
        {band && (
          <View style={[styles.tag, { backgroundColor: BAND_STYLE[band].tint }]}>
            <Text style={[styles.tagText, { color: BAND_STYLE[band].color }]}>{t(BAND_STYLE[band].label)}</Text>
          </View>
        )}
      </View>
      <View style={styles.memberActions}>
        {member.phone && (
          <PressableScale onPress={onCall} style={[styles.actionBtn, { backgroundColor: C.info }]}>
            <Ionicons name="call" size={15} color="#FFFFFF" />
            <Text style={styles.actionText}>{t("Call")}</Text>
          </PressableScale>
        )}
        <PressableScale onPress={onRemind} style={[styles.actionBtn, { backgroundColor: "#25D366" }]}>
          <Ionicons name="logo-whatsapp" size={15} color="#FFFFFF" />
          <Text style={styles.actionText}>{t("Remind")}</Text>
        </PressableScale>
        <PressableScale onPress={onCheckIn} style={[styles.actionBtn, { backgroundColor: C.leaf }]}>
          <Ionicons name="shield-checkmark" size={15} color="#FFFFFF" />
          <Text style={styles.actionText}>{t("Mark safe")}</Text>
        </PressableScale>
        {member.status === "invited" && (
          <PressableScale onPress={onInvite} style={[styles.actionBtn, styles.actionGhost]}>
            <Ionicons name="paper-plane-outline" size={15} color={C.brand} />
            <Text style={[styles.actionText, { color: C.brand }]}>{t("Invite")}</Text>
          </PressableScale>
        )}
      </View>
    </Animated.View>
  );
}

/* ---------------- Screen ---------------- */

export default function FamilyScreen() {
  const { city } = useCity();
  const { user } = useAuth();
  const { t } = useI18n();
  const { members, loading, mode, checkIn, remove } = useFamily();
  const { heat, forecast, memberHeat } = useAlerts();
  const [sheet, setSheet] = useState<{ type: "add" } | { type: "share"; member: FamilyMember } | null>(null);
  const toast = useToast();
  /** Heat band where the member lives (their area, or the app's city when none was set). */
  const bandOf = (m: FamilyMember): HeatBand | null =>
    memberHeat[m.id]?.heat.band ?? (m.areaId ? null : (heat?.band ?? null));

  const inviter = (
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    t("Your family member")
  ).split(" ")[0];
  const now = useNow();
  const heatRisk = (heat && heat.band !== "Low") || forecast?.hours.some((h) => h.band !== "Low");
  const stale = (m: FamilyMember) => !m.lastCheckIn || now - Date.parse(m.lastCheckIn) > 6 * 3600_000;
  const needsCheck = (m: FamilyMember) => {
    const local = memberHeat[m.id]?.heat.band;
    if (m.areaId && !local) return false; // their city's heat hasn't loaded yet
    if (local === "High") return stale(m); // high heat where they live: everyone needs a check
    const risk = local ? local !== "Low" : heatRisk;
    return !!risk && isVulnerable(m) && stale(m);
  };
  const joined = members.filter((m) => m.status === "joined").length;
  const attention = members.filter(needsCheck).length;

  async function call(m: FamilyMember) {
    if (!m.phone || !(await callPhone(m.phone))) toast.show(t("Calling isn't available on this device"));
  }

  async function remind(m: FamilyMember) {
    const area = memberArea(m, city);
    const res = await shareVia("whatsapp", reminderMessage(m.name, t(area.name), bandOf(m) ?? undefined, t), {
      phone: m.phone,
    });
    toast.show(
      res === "opened"
        ? t("Reminder opened in WhatsApp for {name}", { name: m.name })
        : t("Reminder copied to clipboard"),
    );
  }

  function confirmRemove(m: FamilyMember) {
    const go = () => remove(m.id).then(() => toast.show(t("{name} removed", { name: m.name })));
    if (Platform.OS === "web") {
      if (window.confirm(t("Remove {name} from your family circle?", { name: m.name }))) go();
      return;
    }
    Alert.alert(t("Remove member"), t("Remove {name} from your family circle?", { name: m.name }), [
      { text: t("Cancel"), style: "cancel" },
      { text: t("Remove"), style: "destructive", onPress: go },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <ScreenHeader
          eyebrow={t("Family circle")}
          title={t("Family Heat Safety")}
          subtitle={t("Keep an eye on the people you love during peak heat in {city}.", { city: t(city.name) })}
        />

        <Reveal index={0}>
          <PressableScale
            onPress={() => setSheet({ type: "add" })}
            scaleTo={0.98}
            accessibilityRole="button"
            accessibilityLabel={t("Invite a family member")}
          >
            <LinearGradient
              colors={["#E2621B", "#F07B2E", "#F5A262"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.inviteCard}
            >
              <View style={styles.inviteBlob} />
              <View style={styles.inviteBlob2} />
              <View style={styles.flex}>
                <Text style={styles.inviteEyebrow}>{t("GROW YOUR CIRCLE")}</Text>
                <Text style={styles.inviteTitle}>{t("Invite a family member")}</Text>
                <Text style={styles.inviteSub}>{t("Share by WhatsApp, email, SMS or a link")}</Text>
                <View style={styles.inviteIcons}>
                  {(["logo-whatsapp", "mail", "chatbubble-ellipses", "link"] as IconName[]).map((ic) => (
                    <View key={ic} style={styles.inviteIcon}>
                      <Ionicons name={ic} size={14} color="#FFFFFF" />
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.plus}>
                <Ionicons name="person-add" size={26} color={C.brand} />
              </View>
            </LinearGradient>
          </PressableScale>
        </Reveal>

        <Reveal index={1} style={styles.stats}>
          {[
            { n: members.length, l: t("Members"), c: C.ink },
            { n: joined, l: t("Joined"), c: C.low },
            { n: attention, l: t("Need check"), c: attention ? C.high : C.inkMuted },
          ].map((s) => (
            <View key={s.l} style={styles.statBox}>
              <Text style={[styles.statNum, { color: s.c }]}>{s.n}</Text>
              <Text style={styles.statLabel}>{s.l}</Text>
            </View>
          ))}
        </Reveal>

        {loading ? (
          <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />
        ) : members.length === 0 ? (
          <Reveal index={2} style={styles.empty}>
            <Ionicons name="people-circle" size={64} color={C.leafLight} />
            <Text style={styles.emptyTitle}>{t("Your circle is empty")}</Text>
            <Text style={styles.emptyText}>
              {t("Add parents, grandparents or children. We'll alert you to check on them when heat stress rises.")}
            </Text>
          </Reveal>
        ) : (
          members.map((m, i) => (
            <MemberCard
              key={m.id}
              member={m}
              index={i}
              needsCheck={needsCheck(m)}
              areaName={memberArea(m, city).name}
              band={bandOf(m)}
              onRemind={() => remind(m)}
              onCall={() => call(m)}
              onInvite={() => setSheet({ type: "share", member: m })}
              onCheckIn={() => checkIn(m.id).then(() => toast.show(t("{name} marked safe", { name: m.name })))}
              onRemove={() => confirmRemove(m)}
            />
          ))
        )}

        <Reveal index={3} style={styles.tipBox}>
          <View style={styles.tipTitleRow}>
            <Ionicons name="bulb" size={17} color={C.brand} />
            <Text style={styles.tipTitle}>{t("Vulnerable group note")}</Text>
          </View>
          <Text style={styles.tipText}>
            {t(
              "Older adults and young children regulate body heat less well and dehydrate faster. Check on them between 11 AM and 3:30 PM.",
            )}
          </Text>
          <View style={styles.syncRow}>
            <Ionicons
              name={mode === "cloud" ? "cloud-done-outline" : "phone-portrait-outline"}
              size={13}
              color={C.inkMuted}
            />
            <Text style={styles.syncNote}>
              {mode === "cloud" ? t("Synced to your account") : t("Saved on this device")}
            </Text>
          </View>
        </Reveal>
      </ScrollView>

      {toast.node()}

      <Modal visible={sheet !== null} transparent animationType="none" onRequestClose={() => setSheet(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Animated.View entering={FadeIn} style={StyleSheet.absoluteFill}>
            <Pressable style={styles.backdropPress} onPress={() => setSheet(null)} accessibilityLabel={t("Close")} />
          </Animated.View>
          <Animated.View entering={SlideInDown.springify().damping(18)} style={styles.sheet}>
            <View style={styles.grabber} />
            {sheet?.type === "add" && (
              <AddMemberForm
                onCancel={() => setSheet(null)}
                onCreated={(m) => setSheet({ type: "share", member: m })}
              />
            )}
            {sheet?.type === "share" && (
              <ShareSheet
                member={sheet.member}
                inviter={inviter}
                onClose={() => setSheet(null)}
                onShared={toast.show}
              />
            )}
            {toast.node(true)}
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { padding: 20, paddingBottom: 120, width: "100%", maxWidth: 760, alignSelf: "center" },
  flex: { flex: 1 },

  inviteCard: {
    borderRadius: R.xl,
    borderBottomRightRadius: 48,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
    ...shadow(3),
  },
  inviteBlob: {
    position: "absolute",
    right: -30,
    top: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  inviteBlob2: {
    position: "absolute",
    left: -20,
    bottom: -50,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  inviteEyebrow: { color: "rgba(255,255,255,0.85)", fontSize: 10.5, fontFamily: F.bodySemi, letterSpacing: 1.4 },
  inviteTitle: { color: "#FFFFFF", fontSize: 21, fontFamily: F.display, marginTop: 4, letterSpacing: -0.3 },
  inviteSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontFamily: F.body, marginTop: 2 },
  inviteIcons: { flexDirection: "row", gap: 6, marginTop: 12 },
  inviteIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  plus: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow(2),
  },

  stats: { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 6 },
  statBox: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  statNum: { fontSize: 24, fontFamily: F.display },
  statLabel: { fontSize: 11.5, color: C.inkMuted, fontFamily: F.bodySemi, marginTop: 2 },

  memberCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: C.border,
    ...shadow(1),
  },
  memberCardAlert: { borderColor: "#F3B4A8", backgroundColor: "#FFFAF8" },
  memberTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 21, fontFamily: F.display },
  presence: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
  },
  name: { fontSize: 16.5, fontFamily: F.bodySemi, color: C.ink },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
  tag: { backgroundColor: C.bgDeep, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, fontFamily: F.bodySemi, color: C.inkSoft },
  checkedIn: { fontSize: 12, fontFamily: F.body, color: C.inkMuted, marginTop: 5 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" },
  addressText: { flexShrink: 1, fontSize: 13, fontFamily: F.body, color: C.inkSoft },
  areaList: {
    marginTop: 6,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    overflow: "hidden",
  },
  areaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  areaCity: { fontSize: 14.5, fontFamily: F.bodySemi, color: C.ink },
  areaCountry: { fontSize: 13, fontFamily: F.body, color: C.inkMuted },
  memberActions: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: R.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionGhost: { backgroundColor: C.brandTint },
  actionText: { color: "#FFFFFF", fontSize: 13, fontFamily: F.bodySemi },

  empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 18, fontFamily: F.display, color: C.ink, marginTop: 8 },
  emptyText: { fontSize: 14, fontFamily: F.body, color: C.inkSoft, textAlign: "center", lineHeight: 20, marginTop: 6 },

  tipBox: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 18,
  },
  tipTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  tipTitle: { fontSize: 15, fontFamily: F.bodySemi, color: C.ink },
  tipText: { fontSize: 13.5, fontFamily: F.body, color: C.inkSoft, lineHeight: 19 },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  syncNote: { fontSize: 11.5, color: C.inkMuted, fontFamily: F.bodySemi },

  toastBottom: { bottom: 110 },
  toastTop: { top: 14 },
  toast: {
    position: "absolute",
    zIndex: 20,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.leaf,
    borderRadius: R.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: "90%",
    ...shadow(3),
  },
  toastText: { color: "#FFFFFF", fontSize: 13, fontFamily: F.bodySemi },

  backdrop: { flex: 1, justifyContent: "flex-end" },
  backdropPress: { flex: 1, backgroundColor: "rgba(20,12,8,0.5)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "92%",
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
    marginTop: 10,
  },
  sheetBody: { padding: 22, paddingBottom: 36 },
  sheetTitle: { fontSize: 22, fontFamily: F.display, color: C.ink, letterSpacing: -0.4, textAlign: "center" },
  sheetSub: {
    fontSize: 14,
    fontFamily: F.body,
    color: C.inkSoft,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 6,
  },
  fieldLabel: { fontSize: 12.5, fontFamily: F.bodySemi, color: C.inkSoft, marginTop: 16, marginBottom: 8 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surfaceWarm,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontSize: 15.5,
    color: C.ink,
    paddingVertical: 13,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
  relations: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  relChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    backgroundColor: C.surfaceWarm,
    borderWidth: 1,
    borderColor: C.border,
  },
  relChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  relText: { fontSize: 13, fontFamily: F.bodySemi, color: C.inkSoft },
  relTextOn: { color: "#FFFFFF" },
  vulnNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  vulnText: { fontSize: 12.5, color: C.high, fontFamily: F.bodySemi },
  error: { color: C.high, fontFamily: F.bodySemi, marginTop: 14, textAlign: "center" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.brand,
    borderRadius: R.md,
    paddingVertical: 15,
    marginTop: 22,
    ...shadow(2),
  },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontFamily: F.bodySemi },
  cancel: { alignSelf: "center", padding: 12 },
  cancelText: { color: C.inkMuted, fontFamily: F.bodySemi },

  successBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.leaf,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  linkBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surfaceWarm,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    padding: 14,
    marginTop: 16,
  },
  linkLabel: { fontSize: 10, fontFamily: F.bodySemi, letterSpacing: 1.2, color: C.inkMuted },
  code: { fontSize: 24, fontFamily: F.display, color: C.ink, letterSpacing: 3, marginTop: 2 },
  link: { fontSize: 11.5, fontFamily: F.body, color: C.inkMuted, marginTop: 2 },
  copyBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },
  channels: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  channelCol: { alignItems: "center", gap: 6, flex: 1 },
  channel: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", ...shadow(2) },
  channelLabel: { fontSize: 12, fontFamily: F.bodySemi, color: C.inkSoft },
  doneBtn: { backgroundColor: C.ink, borderRadius: R.md, paddingVertical: 14, alignItems: "center", marginTop: 26 },
  doneText: { color: "#FFFFFF", fontSize: 15, fontFamily: F.bodySemi },
});
