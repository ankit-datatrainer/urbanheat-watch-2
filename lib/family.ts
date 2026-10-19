import { Linking, Platform, Share } from "react-native";
import * as ExpoLinking from "expo-linking";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { translate, tx, type TFunction } from "./i18n";

export type Relation = "Parent" | "Grandparent" | "Child" | "Sibling" | "Partner" | "Friend" | "Other";
export const RELATIONS: Relation[] = [
  tx("Parent"),
  tx("Grandparent"),
  tx("Child"),
  tx("Sibling"),
  tx("Partner"),
  tx("Friend"),
  tx("Other"),
];

/** Older adults and children regulate body heat less well, so they get extra alerts. */
export const VULNERABLE: Relation[] = ["Grandparent", "Child"];

export type FamilyMember = {
  id: string;
  name: string;
  relation: Relation;
  email: string | null;
  phone: string | null;
  inviteCode: string;
  status: "invited" | "joined";
  lastCheckIn: string | null; // ISO time of the last "I'm safe" confirmation
  createdAt: string;
};

export type NewMember = Pick<FamilyMember, "name" | "relation" | "email" | "phone">;

export function isVulnerable(m: Pick<FamilyMember, "relation">) {
  return VULNERABLE.includes(m.relation);
}

export function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function inviteLink(code: string, from?: string) {
  return ExpoLinking.createURL("/invite", { queryParams: { code, ...(from ? { from } : {}) } });
}

const en: TFunction = (text, vars) => translate("en", text, vars);

export function inviteMessage(
  member: Pick<FamilyMember, "name" | "inviteCode">,
  from: string,
  city: string,
  t: TFunction = en,
) {
  const link = inviteLink(member.inviteCode, from);
  return (
    t(
      "Hi {name}! {from} invited you to their family circle on UrbanHeat Watch, the heat-safety app. We'll get heat alerts for {city} and can check on each other on very hot days.",
      { name: member.name, from, city },
    ) + `\n\n${t("Join here: {link}", { link })}\n${t("Invite code: {code}", { code: member.inviteCode })}`
  );
}

export function reminderMessage(name: string, city: string, band?: string, t: TFunction = en) {
  const level = band ? t(`${band} heat stress`).toLowerCase() : t("hot weather");
  return t(
    "Hi {name}, UrbanHeat Watch shows {level} in {city} today. Please drink water regularly, stay in the shade or indoors during the hottest hours, and let me know you're OK.",
    { name, level, city },
  );
}

const digits = (phone: string) => phone.replace(/[^\d]/g, "");

/**
 * Copies text. On web the synchronous textarea copy runs first because some browsers leave the async
 * clipboard permission prompt pending forever; the async API is raced against a timeout as a backup.
 */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    try {
      if (document.execCommand("copy")) return true;
    } catch {
      // fall through to the async clipboard API
    } finally {
      document.body.removeChild(field);
    }
  }
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500));
  return Promise.race([Clipboard.setStringAsync(text).catch(() => false), timeout]);
}

export type ShareChannel = "whatsapp" | "email" | "sms" | "more" | "copy";

/** Opens the chosen app with `message` pre-filled. Returns a short status for the UI. */
export async function shareVia(
  channel: ShareChannel,
  message: string,
  to: { email?: string | null; phone?: string | null; subject?: string } = {},
): Promise<"opened" | "copied" | "unavailable"> {
  const text = encodeURIComponent(message);
  try {
    switch (channel) {
      case "whatsapp": {
        const phone = to.phone ? digits(to.phone) : "";
        await Linking.openURL(`https://wa.me/${phone}?text=${text}`);
        return "opened";
      }
      case "email": {
        const subject = encodeURIComponent(to.subject ?? "UrbanHeat Watch");
        await Linking.openURL(`mailto:${to.email ?? ""}?subject=${subject}&body=${text}`);
        return "opened";
      }
      case "sms": {
        const sep = Platform.OS === "ios" ? "&" : "?";
        await Linking.openURL(`sms:${to.phone ? digits(to.phone) : ""}${sep}body=${text}`);
        return "opened";
      }
      case "more": {
        await Share.share({ message });
        return "opened";
      }
      case "copy": {
        return (await copyText(message)) ? "copied" : "unavailable";
      }
    }
  } catch {
    // No share sheet (desktop browsers) or the app isn't installed: copy instead.
    return (await copyText(message)) ? "copied" : "unavailable";
  }
}

/* ---------------- Storage ----------------
 * Signed-in users are stored in the Supabase `family_members` table (see supabase/schema.sql).
 * Guests, or projects where that table hasn't been created yet, keep the list on the device.
 */

type Row = {
  id: string;
  name: string;
  relation: Relation;
  email: string | null;
  phone: string | null;
  invite_code: string;
  status: "invited" | "joined";
  last_check_in: string | null;
  created_at: string;
};

const fromRow = (r: Row): FamilyMember => ({
  id: r.id,
  name: r.name,
  relation: r.relation,
  email: r.email,
  phone: r.phone,
  inviteCode: r.invite_code,
  status: r.status,
  lastCheckIn: r.last_check_in,
  createdAt: r.created_at,
});

const localKey = (userId: string | null) => `uhw:family:${userId ?? "guest"}`;

const missingTable = (code?: string) => code === "PGRST205" || code === "42P01";

export type FamilyStore = {
  mode: "cloud" | "local";
  list(): Promise<FamilyMember[]>;
  add(m: NewMember): Promise<FamilyMember>;
  update(id: string, patch: Partial<Pick<FamilyMember, "lastCheckIn" | "status">>): Promise<void>;
  remove(id: string): Promise<void>;
};

function localStore(userId: string | null): FamilyStore {
  const key = localKey(userId);
  const read = async (): Promise<FamilyMember[]> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as FamilyMember[]) : [];
    } catch {
      return [];
    }
  };
  const write = (list: FamilyMember[]) => AsyncStorage.setItem(key, JSON.stringify(list)).catch(() => {});
  return {
    mode: "local",
    list: read,
    async add(m) {
      const member: FamilyMember = {
        ...m,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        inviteCode: makeInviteCode(),
        status: "invited",
        lastCheckIn: null,
        createdAt: new Date().toISOString(),
      };
      await write([...(await read()), member]);
      return member;
    },
    async update(id, patch) {
      await write((await read()).map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    async remove(id) {
      await write((await read()).filter((m) => m.id !== id));
    },
  };
}

function cloudStore(): FamilyStore {
  return {
    mode: "cloud",
    async list() {
      const { data, error } = await supabase.from("family_members").select("*").order("created_at");
      if (error) throw error;
      return (data as Row[]).map(fromRow);
    },
    async add(m) {
      const { data, error } = await supabase
        .from("family_members")
        .insert({ name: m.name, relation: m.relation, email: m.email, phone: m.phone, invite_code: makeInviteCode() })
        .select()
        .single();
      if (error) throw error;
      return fromRow(data as Row);
    },
    async update(id, patch) {
      const { error } = await supabase
        .from("family_members")
        .update({
          ...(patch.lastCheckIn !== undefined ? { last_check_in: patch.lastCheckIn } : {}),
          ...(patch.status ? { status: patch.status } : {}),
        })
        .eq("id", id);
      if (error) throw error;
    },
    async remove(id) {
      const { error } = await supabase.from("family_members").delete().eq("id", id);
      if (error) throw error;
    },
  };
}

/** Picks Supabase for signed-in users when the table exists, otherwise on-device storage. */
export async function openFamilyStore(userId: string | null): Promise<FamilyStore> {
  if (!userId) return localStore(null);
  const { error } = await supabase.from("family_members").select("id").limit(1);
  if (!error) return cloudStore();
  if (!missingTable(error.code)) console.warn("Family sync unavailable, using this device:", error.message);
  return localStore(userId);
}

/** Accepts an invite for the signed-in user. Needs the `accept_family_invite` function from schema.sql. */
export async function acceptInvite(code: string): Promise<{ ok: boolean; inviter?: string; message?: string }> {
  const { data, error } = await supabase.rpc("accept_family_invite", { code: code.trim().toUpperCase() });
  if (error) {
    if (missingTable(error.code) || error.code === "PGRST202") {
      return { ok: false, message: "Family sync isn't enabled on the server yet (run supabase/schema.sql)." };
    }
    return { ok: false, message: error.message };
  }
  if (!data) return { ok: false, message: "This invite code wasn't found or has already been used." };
  return { ok: true, inviter: typeof data === "string" ? data : undefined };
}
