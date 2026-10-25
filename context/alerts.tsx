import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCity } from "../components/CityContext";
import { useFamily } from "./family";
import { useI18n } from "../lib/i18n";
import { fetchCityHeat, type CityHeat } from "../lib/heat";
import { memberArea } from "../lib/family";
import { ASEAN_CITIES } from "../components/aseanCities";
import {
  NOTIFY_SEVERITIES,
  buildAlerts,
  fetchAirQuality,
  fetchForecast,
  type AirQuality,
  type DynamicAlert,
  type Forecast,
  type MemberHeat,
} from "../lib/alerts";

const REFRESH_MS = 5 * 60_000;
const STORE_KEY = "uhw:alerts:state";

type AlertsContextType = {
  alerts: DynamicAlert[];
  heat: CityHeat | null;
  forecast: Forecast | null;
  air: AirQuality | null;
  /** Live heat where each family member lives, keyed by member id. */
  memberHeat: Record<string, MemberHeat>;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number | null;
  /** Unseen alerts worth a badge (critical, warning, advisory). */
  unread: number;
  /** Most recent alert that appeared since the last refresh, for the in-app toast. */
  fresh: DynamicAlert | null;
  clearFresh: () => void;
  refresh: () => Promise<void>;
  markAllSeen: () => void;
  dismiss: (id: string) => void;
  restoreDismissed: () => void;
  dismissedCount: number;
};

const AlertsContext = createContext<AlertsContextType | undefined>(undefined);

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { city } = useCity();
  const { members } = useFamily();
  const { t, locale } = useI18n();
  // Readings are tagged with their city so switching city starts fresh without resetting state in an effect.
  const [data, setData] = useState<{
    cityId: string;
    heat: CityHeat | null;
    forecast: Forecast | null;
    air: AirQuality | null;
    /** Heat in the other cities family members live in, keyed by city id. */
    areaHeat: Record<string, CityHeat>;
    updatedAt: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const current = data?.cityId === city.id ? data : null;
  const loading = !current;
  const heat = current?.heat ?? null;
  const forecast = current?.forecast ?? null;
  const air = current?.air ?? null;
  const updatedAt = current?.updatedAt ?? null;
  // Member cities other than the app's city, as a stable key so the loader re-runs only when they change.
  const areaKey = useMemo(
    () =>
      [...new Set(members.map((m) => m.areaId).filter((id): id is string => !!id && id !== city.id))].sort().join(","),
    [members, city.id],
  );
  const [seen, setSeen] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [fresh, setFresh] = useState<DynamicAlert | null>(null);
  const knownIds = useRef<Set<string> | null>(null);

  // Restore which alerts were already read or dismissed.
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        const s = JSON.parse(raw);
        setSeen(Array.isArray(s.seen) ? s.seen.slice(-200) : []);
        setDismissed(Array.isArray(s.dismissed) ? s.dismissed.slice(-200) : []);
      })
      .catch(() => {});
  }, []);

  const persist = useCallback((next: { seen: string[]; dismissed: string[] }) => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const areas = areaKey ? ASEAN_CITIES.filter((c) => areaKey.split(",").includes(c.id)) : [];
    const [[h, f, a], areaResults] = await Promise.all([
      Promise.allSettled([
        fetchCityHeat(city.lat, city.lon),
        fetchForecast(city.lat, city.lon),
        fetchAirQuality(city.lat, city.lon),
      ]),
      Promise.allSettled(areas.map((c) => fetchCityHeat(c.lat, c.lon))),
    ]);
    // A failed source keeps its last good value for this city.
    setData((prev) => {
      const same = prev?.cityId === city.id ? prev : null;
      const areaHeat: Record<string, CityHeat> = {};
      areas.forEach((c, i) => {
        const r = areaResults[i]!;
        const v = r.status === "fulfilled" ? r.value : same?.areaHeat[c.id];
        if (v) areaHeat[c.id] = v;
      });
      return {
        cityId: city.id,
        heat: h.status === "fulfilled" ? h.value : (same?.heat ?? null),
        forecast: f.status === "fulfilled" ? f.value : (same?.forecast ?? null),
        air: a.status === "fulfilled" ? a.value : (same?.air ?? null),
        areaHeat,
        updatedAt: Date.now(),
      };
    });
    setRefreshing(false);
  }, [city.id, city.lat, city.lon, areaKey]);

  useEffect(() => {
    knownIds.current = null; // a new city should not toast every alert at once
    // load() only sets state after its network requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(load, REFRESH_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") load();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  const areaHeat = current?.areaHeat;
  const memberHeat = useMemo(() => {
    const out: Record<string, MemberHeat> = {};
    for (const m of members) {
      if (!m.areaId) continue; // no area chosen: their alerts follow the app's city
      const area = memberArea(m, city);
      const h = area.id === city.id ? heat : areaHeat?.[area.id];
      if (h) out[m.id] = { heat: h, areaName: area.name };
    }
    return out;
  }, [members, city, heat, areaHeat]);

  const all = useMemo(
    () => (loading ? [] : buildAlerts({ cityName: city.name, heat, forecast, air, members, memberHeat, t, locale })),
    [loading, city.name, heat, forecast, air, members, memberHeat, t, locale],
  );
  const alerts = useMemo(() => all.filter((a) => !dismissed.includes(a.id)), [all, dismissed]);

  // Toast any important alert that wasn't there on the previous refresh.
  useEffect(() => {
    if (loading) return;
    const ids = new Set(all.map((a) => a.id));
    if (knownIds.current) {
      const added = alerts.find((a) => NOTIFY_SEVERITIES.includes(a.severity) && !knownIds.current!.has(a.id));
      if (added) setFresh(added);
    }
    knownIds.current = ids;
  }, [all, alerts, loading]);

  const unread = alerts.filter((a) => NOTIFY_SEVERITIES.includes(a.severity) && !seen.includes(a.id)).length;

  const markAllSeen = useCallback(() => {
    setSeen((prev) => {
      const ids = alerts.map((a) => a.id).filter((id) => !prev.includes(id));
      if (!ids.length) return prev;
      const next = [...prev, ...ids].slice(-200);
      persist({ seen: next, dismissed });
      return next;
    });
  }, [alerts, dismissed, persist]);

  const dismiss = useCallback(
    (id: string) => {
      setDismissed((prev) => {
        const next = [...prev, id].slice(-200);
        persist({ seen, dismissed: next });
        return next;
      });
    },
    [seen, persist],
  );

  const restoreDismissed = useCallback(() => {
    setDismissed([]);
    persist({ seen, dismissed: [] });
  }, [seen, persist]);

  const dismissedCount = all.filter((a) => dismissed.includes(a.id)).length;

  return (
    <AlertsContext.Provider
      value={{
        alerts,
        heat,
        forecast,
        air,
        memberHeat,
        loading,
        refreshing,
        updatedAt,
        unread,
        fresh,
        clearFresh: () => setFresh(null),
        refresh: () => {
          setRefreshing(true);
          return load();
        },
        markAllSeen,
        dismiss,
        restoreDismissed,
        dismissedCount,
      }}
    >
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used inside AlertsProvider");
  return ctx;
}
