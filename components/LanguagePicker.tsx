import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeInDown, SlideInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LANGUAGES, useI18n, type Lang } from "../lib/i18n";
import PressableScale from "./ui/PressableScale";
import { C, F, R, shadow } from "./ui/theme";

/** The list of languages, used inline on onboarding and inside the picker sheet. */
export function LanguageList({ onPick }: { onPick?: (l: Lang) => void }) {
  const { lang, setLang } = useI18n();
  return (
    <View style={styles.list}>
      {LANGUAGES.map((l, i) => {
        const on = l.code === lang;
        return (
          <Animated.View
            key={l.code}
            entering={FadeInDown.delay(40 * i)
              .springify()
              .damping(18)}
          >
            <PressableScale
              scaleTo={0.98}
              onPress={() => {
                setLang(l.code);
                onPick?.(l.code);
              }}
              style={[styles.row, on && styles.rowOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={styles.flex}>
                <Text style={[styles.native, on && styles.nativeOn]}>{l.native}</Text>
                <Text style={styles.english}>{l.english}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </View>
            </PressableScale>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Globe button that opens the language sheet. `tone="light"` for dark backgrounds. */
export default function LanguageButton({
  tone = "dark",
  style,
}: {
  tone?: "dark" | "light";
  style?: StyleProp<ViewStyle>;
}) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const light = tone === "light";
  const short = lang === "zh-HK" ? "繁" : lang === "zh-CN" ? "简" : lang.toUpperCase();

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        style={[styles.button, light ? styles.buttonLight : styles.buttonDark, style]}
        accessibilityLabel={t("Change language")}
      >
        <Ionicons name="language" size={16} color={light ? "#FFFFFF" : C.ink} />
        <Text style={[styles.buttonText, { color: light ? "#FFFFFF" : C.ink }]}>{short}</Text>
      </PressableScale>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Animated.View entering={FadeIn} style={StyleSheet.absoluteFill}>
            <Pressable style={styles.backdropPress} onPress={() => setOpen(false)} accessibilityLabel={t("Close")} />
          </Animated.View>
          <Animated.View entering={SlideInDown.springify().damping(18)} style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{t("Choose your language")}</Text>
            <Text style={styles.sub}>{t("The whole app, including the AI assistant, switches language.")}</Text>
            <LanguageList onPick={() => setTimeout(() => setOpen(false), 180)} />
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowOn: { borderColor: C.brand, backgroundColor: C.brandTint },
  native: { fontSize: 16, fontFamily: F.bodyMedium, color: C.ink },
  nativeOn: { color: C.brandDeep },
  english: { fontSize: 12.5, fontFamily: F.body, color: C.inkMuted, marginTop: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { backgroundColor: C.brand, borderColor: C.brand },

  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: R.pill,
  },
  buttonDark: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  buttonLight: { backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  buttonText: { fontSize: 12.5, fontFamily: F.bodySemi, letterSpacing: 0.4 },

  backdrop: { flex: 1, justifyContent: "flex-end" },
  backdropPress: { flex: 1, backgroundColor: "rgba(20,12,8,0.5)" },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 34,
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
    marginBottom: 14,
  },
  title: { fontSize: 22, fontFamily: F.display, color: C.ink, letterSpacing: -0.3 },
  sub: { fontSize: 13.5, fontFamily: F.body, color: C.inkSoft, marginTop: 4, marginBottom: 16 },
});
