import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ms from "./locales/ms.json";
import zhHK from "./locales/zh-HK.json";
import zhCN from "./locales/zh-CN.json";
import hi from "./locales/hi.json";
import ta from "./locales/ta.json";
import te from "./locales/te.json";

export type Lang = "en" | "ms" | "zh-HK" | "zh-CN" | "hi" | "ta" | "te";

export const LANGUAGES: { code: Lang; native: string; english: string; aiName: string }[] = [
  { code: "en", native: "English", english: "English", aiName: "English" },
  { code: "ms", native: "Bahasa Melayu", english: "Malay (Singapore)", aiName: "Malay (Bahasa Melayu)" },
  {
    code: "zh-HK",
    native: "繁體中文（香港）",
    english: "Cantonese (Hong Kong)",
    aiName: "Traditional Chinese as written in Hong Kong",
  },
  { code: "zh-CN", native: "简体中文", english: "Chinese (Simplified)", aiName: "Simplified Chinese" },
  { code: "hi", native: "हिन्दी", english: "Hindi", aiName: "Hindi" },
  { code: "ta", native: "தமிழ்", english: "Tamil", aiName: "Tamil" },
  { code: "te", native: "తెలుగు", english: "Telugu", aiName: "Telugu" },
];

// Dictionaries are keyed by the English source text, so any string without a translation
// simply shows in English instead of a missing-key placeholder.
const DICTS: Record<Exclude<Lang, "en">, Record<string, string>> = {
  ms,
  "zh-HK": zhHK,
  "zh-CN": zhCN,
  hi,
  ta,
  te,
};

export type Vars = Record<string, string | number>;
export type TFunction = (text: string, vars?: Vars) => string;

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Marks a static string for translation without translating it yet (it is passed to t() where
 * it is shown). The string extractor collects both t("...") and tx("...") calls.
 */
export const tx = <T extends string>(text: T) => text;

export function translate(lang: Lang, text: string, vars?: Vars) {
  const dict = lang === "en" ? null : DICTS[lang];
  return fill((dict && dict[text]) || text, vars);
}

const STORE_KEY = "uhw:language";

type I18n = {
  lang: Lang;
  /** True once the saved language has been read (or there was none). */
  ready: boolean;
  /** Whether the person has picked a language at least once. */
  chosen: boolean;
  setLang: (l: Lang) => void;
  t: TFunction;
  /** BCP-47 tag for dates and numbers. */
  locale: string;
};

const I18nContext = createContext<I18n | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((v) => {
        if (v && LANGUAGES.some((l) => l.code === v)) {
          setLangState(v as Lang);
          setChosen(true);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setChosen(true);
    AsyncStorage.setItem(STORE_KEY, l).catch(() => {});
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      ready,
      chosen,
      setLang,
      t: (text, vars) => translate(lang, text, vars),
      locale: lang === "ms" ? "ms-SG" : lang === "hi" || lang === "ta" || lang === "te" ? `${lang}-IN` : lang,
    }),
    [lang, ready, chosen, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}

export const useT = () => useI18n().t;
