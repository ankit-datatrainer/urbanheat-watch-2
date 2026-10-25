import type { Ionicons } from "@expo/vector-icons";
import { bandFor, estimateWbgt, type CityHeat, type HeatBand } from "./heat";
import { isVulnerable, type FamilyMember } from "./family";
import { translate, type TFunction } from "./i18n";

export type Severity = "critical" | "warning" | "advisory" | "info" | "ok";
export type AlertKind = "heat" | "forecast" | "uv" | "air" | "rain" | "family" | "tip";

export type DynamicAlert = {
  id: string; // stable for the same condition, so dismissals and "seen" survive refreshes
  kind: AlertKind;
  severity: Severity;
  title: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
  action?: { label: string; route: "/family" | "/ai" | "/heatmap"; query?: string };
  /** The family member this alert is about, for its Call and Message buttons. */
  contact?: { memberId: string; name: string; phone: string | null };
};

/** Live heat where a family member lives, with that city's name. */
export type MemberHeat = { heat: CityHeat; areaName: string };

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, advisory: 2, ok: 2.5, info: 3 };
export const NOTIFY_SEVERITIES: Severity[] = ["critical", "warning", "advisory"];

export type HourPoint = {
  time: string;
  temp: number;
  rh: number;
  uv: number;
  rain: number;
  wbgt: number;
  band: HeatBand;
};
export type Forecast = { hours: HourPoint[] };
export type AirQuality = { aqi: number; pm25: number | null };

/** Next 24 hours of city-local hourly weather from Open-Meteo (free, no key). */
export async function fetchForecast(lat: number, lon: number): Promise<Forecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,relative_humidity_2m,uv_index,precipitation_probability&forecast_days=2&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Forecast request failed (${res.status})`);
  const j = await res.json();
  const h = j.hourly;
  // Open-Meteo returns city-local times without an offset; compare against "now" shifted the same way.
  const nowLocal = new Date(Date.now() + (j.utc_offset_seconds ?? 0) * 1000).toISOString().slice(0, 13);
  const hours: HourPoint[] = [];
  for (let i = 0; i < h.time.length && hours.length < 24; i++) {
    if (h.time[i].slice(0, 13) < nowLocal) continue;
    const temp = h.temperature_2m[i];
    const rh = h.relative_humidity_2m[i];
    if (typeof temp !== "number" || typeof rh !== "number") continue;
    const wbgt = Math.round(estimateWbgt(temp, rh) * 10) / 10;
    hours.push({
      time: h.time[i],
      temp,
      rh,
      uv: h.uv_index?.[i] ?? 0,
      rain: h.precipitation_probability?.[i] ?? 0,
      wbgt,
      band: bandFor(wbgt),
    });
  }
  return { hours };
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Air quality request failed (${res.status})`);
  const j = await res.json();
  if (typeof j.current?.us_aqi !== "number") throw new Error("No air quality data");
  return { aqi: j.current.us_aqi, pm25: j.current.pm2_5 ?? null };
}

/** "2026-10-17T14:00" -> "2 PM" in the app language (the string is already in city-local time). */
export function hourLabel(time: string, locale = "en") {
  const h = Number(time.slice(11, 13));
  try {
    return new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString(locale, { hour: "numeric", timeZone: "UTC" });
  } catch {
    return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  }
}

function windowOf(hours: HourPoint[], pred: (h: HourPoint) => boolean) {
  const idx = hours.findIndex(pred);
  if (idx < 0) return null;
  let end = idx;
  while (end + 1 < hours.length && pred(hours[end + 1])) end++;
  return { from: hours[idx], to: hours[end] };
}

const range = (w: { from: HourPoint; to: HourPoint }, t: TFunction, locale: string) => {
  const endHour = (Number(w.to.time.slice(11, 13)) + 1) % 24;
  const endLabel = hourLabel(`0000-00-00T${String(endHour).padStart(2, "0")}`, locale);
  return t("{from} to {to}", { from: hourLabel(w.from.time, locale), to: endLabel });
};

type Inputs = {
  cityName: string;
  heat: CityHeat | null;
  forecast: Forecast | null;
  air: AirQuality | null;
  members: FamilyMember[];
  /** Heat where each member lives, keyed by member id (members without an area are missing). */
  memberHeat?: Record<string, MemberHeat>;
  t?: TFunction;
  locale?: string;
};

/** Turns live readings into a ranked list of alerts. Pure, so it is easy to test. */
export function buildAlerts({
  cityName,
  heat,
  forecast,
  air,
  members,
  memberHeat = {},
  t = (s, v) => translate("en", s, v),
  locale = "en",
}: Inputs): DynamicAlert[] {
  const hl = (time: string) => hourLabel(time, locale);
  const city = t(cityName);
  const out: DynamicAlert[] = [];
  const hours = forecast?.hours ?? [];
  const day = hours[0]?.time.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  // 1. Heat right now
  if (heat) {
    if (heat.band === "High") {
      out.push({
        id: `heat-now-high-${day}`,
        kind: "heat",
        severity: "critical",
        icon: "flame",
        title: t("Extreme heat stress in {city}", { city }),
        message: t(
          "WBGT is {wbgt}°C ({temp}°C, {rh}% humidity). Stay indoors or in shade, postpone exercise and drink water every 15 to 20 minutes.",
          { wbgt: heat.wbgt, temp: Math.round(heat.temperature), rh: heat.humidity },
        ),
        action: {
          label: t("Ask AI what to do"),
          route: "/ai",
          query: `It's extreme heat (WBGT ${heat.wbgt}°C) in ${cityName}. What should my family do right now?`,
        },
      });
    } else if (heat.band === "Moderate") {
      out.push({
        id: `heat-now-mod-${day}`,
        kind: "heat",
        severity: "warning",
        icon: "warning",
        title: t("Moderate heat stress now"),
        message: t(
          "WBGT is {wbgt}°C. Take 15 minutes of shaded rest for every 45 minutes of activity and keep drinking water.",
          { wbgt: heat.wbgt },
        ),
      });
    }
  }

  // 2. What's coming in the next 24 hours
  const peak = hours.reduce<HourPoint | null>((p, h) => (!p || h.wbgt > p.wbgt ? h : p), null);
  if (peak && peak.band !== "Low" && (!heat || peak.wbgt > heat.wbgt + 0.4)) {
    const w = windowOf(hours, (h) => h.band !== "Low");
    out.push({
      id: `forecast-${peak.band}-${peak.time}`,
      kind: "forecast",
      severity: peak.band === "High" ? "warning" : "advisory",
      icon: "trending-up",
      title: peak.band === "High" ? t("Dangerous heat on the way") : t("Heat building later"),
      message: w
        ? t(
            "WBGT is forecast to reach {wbgt}°C around {time}, with elevated heat from {range}. Plan outdoor activity outside these hours.",
            { wbgt: peak.wbgt, time: hl(peak.time), range: range(w, t, locale) },
          )
        : t("WBGT is forecast to reach {wbgt}°C around {time}. Plan outdoor activity outside these hours.", {
            wbgt: peak.wbgt,
            time: hl(peak.time),
          }),
    });
  }

  // 3. UV in the next 12 hours
  const uvPeak = hours.slice(0, 12).reduce<HourPoint | null>((p, h) => (!p || h.uv > p.uv ? h : p), null);
  if (uvPeak && uvPeak.uv >= 6) {
    const extreme = uvPeak.uv >= 8;
    out.push({
      id: `uv-${extreme ? "vh" : "h"}-${day}`,
      kind: "uv",
      severity: extreme ? "warning" : "advisory",
      icon: "sunny",
      title: extreme
        ? t("Very high UV ({uv})", { uv: Math.round(uvPeak.uv) })
        : t("High UV ({uv})", { uv: Math.round(uvPeak.uv) }),
      message: t(
        "UV peaks around {time}. Wear a hat and sunglasses, use SPF 30+ and seek shade between 11 AM and 3 PM.",
        {
          time: hl(uvPeak.time),
        },
      ),
    });
  }

  // 4. Rain and storms in the next 6 hours
  const rainPeak = hours.slice(0, 6).reduce<HourPoint | null>((p, h) => (!p || h.rain > p.rain ? h : p), null);
  if (rainPeak && rainPeak.rain >= 70) {
    out.push({
      id: `rain-${rainPeak.time}`,
      kind: "rain",
      severity: "info",
      icon: "thunderstorm",
      title: t("Showers likely soon"),
      message: t(
        "{pct}% chance of rain around {time}. Rain can bring brief relief, but humidity stays high afterwards.",
        {
          pct: rainPeak.rain,
          time: hl(rainPeak.time),
        },
      ),
    });
  }

  // 5. Air quality
  if (air) {
    const sev: Severity | null =
      air.aqi > 200 ? "critical" : air.aqi > 150 ? "warning" : air.aqi > 100 ? "advisory" : null;
    if (sev) {
      out.push({
        id: `air-${sev}-${day}`,
        kind: "air",
        severity: sev,
        icon: "cloud",
        title:
          sev === "advisory"
            ? t("Air unhealthy for sensitive groups (AQI {aqi})", { aqi: air.aqi })
            : t("Unhealthy air (AQI {aqi})", { aqi: air.aqi }),
        message:
          (air.pm25 != null ? `${t("PM2.5 is {v} µg/m³.", { v: air.pm25 })} ` : "") +
          t("Children, older adults and people with asthma should limit time outdoors and keep windows closed."),
      });
    }
  }

  // 6. Family
  const heatRisk = (heat && heat.band !== "Low") || (peak && peak.band !== "Low");
  const sixHoursAgo = Date.now() - 6 * 3600_000;
  for (const m of members) {
    const contact = { memberId: m.id, name: m.name, phone: m.phone };
    const local = memberHeat[m.id];
    // A member with a home city is judged only on that city's heat; wait until it has loaded.
    if (m.areaId && !local) continue;
    // High heat stress where the member lives is an active alert, whoever they are.
    if (local?.heat.band === "High") {
      out.push({
        id: `family-high-${m.id}-${day}`,
        kind: "family",
        severity: "critical",
        icon: "people",
        title: t("High heat stress where {name} lives", { name: m.name }),
        message: t(
          "{area}: WBGT {wbgt}°C ({temp}°C). Call or message {name}: stay indoors or in shade, drink water often and rest.",
          { area: t(local.areaName), wbgt: local.heat.wbgt, temp: Math.round(local.heat.temperature), name: m.name },
        ),
        contact,
      });
      continue;
    }
    const atRisk = local ? local.heat.band !== "Low" : heatRisk;
    if (atRisk && isVulnerable(m) && (!m.lastCheckIn || Date.parse(m.lastCheckIn) < sixHoursAgo)) {
      out.push({
        id: `family-${m.id}-${day}`,
        kind: "family",
        severity: "warning",
        icon: "people",
        title: t("Check on {name}", { name: m.name }),
        message:
          m.relation === "Child"
            ? t("Children feel heat faster. Send {name} a quick reminder to drink water and stay cool.", {
                name: m.name,
              })
            : t("Older adults feel heat faster. Send {name} a quick reminder to drink water and stay cool.", {
                name: m.name,
              }),
        action: { label: t("Open family"), route: "/family" },
        contact,
      });
    }
  }
  const pending = members.filter((m) => m.status === "invited").length;
  if (pending > 0) {
    out.push({
      id: `family-pending-${pending}`,
      kind: "family",
      severity: "info",
      icon: "mail-unread",
      title: pending > 1 ? t("{n} family invites pending", { n: pending }) : t("1 family invite pending"),
      message: t("Resend the invite on WhatsApp or email so everyone gets heat alerts."),
      action: { label: t("Resend invites"), route: "/family" },
    });
  }

  // 7. Best time to be outside today
  const daytime = hours.filter((h) => {
    const hr = Number(h.time.slice(11, 13));
    return hr >= 6 && hr <= 19;
  });
  const coolest = daytime.reduce<HourPoint | null>((p, h) => (!p || h.wbgt < p.wbgt ? h : p), null);
  if (coolest) {
    out.push({
      id: `tip-coolest-${coolest.time}`,
      kind: "tip",
      severity: "info",
      icon: "time",
      title: t("Coolest time outside: {time}", { time: hl(coolest.time) }),
      message: t("WBGT is expected to be {wbgt}°C then, the best time for exercise or errands.", {
        wbgt: coolest.wbgt,
      }),
    });
  }

  if (!out.some((a) => a.severity !== "info")) {
    out.unshift({
      id: `ok-${day}`,
      kind: "heat",
      severity: "ok",
      icon: "shield-checkmark",
      title: t("No active heat warnings"),
      message: heat
        ? t("Conditions in {city} are in the safe band (WBGT {wbgt}°C). Normal outdoor activities are OK.", {
            city,
            wbgt: heat.wbgt,
          })
        : t("No warnings for {city} right now.", { city }),
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
