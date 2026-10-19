import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import { openFamilyStore, type FamilyMember, type FamilyStore, type NewMember } from "../lib/family";

type FamilyContextType = {
  members: FamilyMember[];
  loading: boolean;
  /** "cloud" when synced to Supabase, "local" when kept on this device. */
  mode: "cloud" | "local";
  add: (m: NewMember) => Promise<FamilyMember>;
  checkIn: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const FamilyContext = createContext<FamilyContextType | undefined>(undefined);

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const storeRef = useRef<FamilyStore | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"cloud" | "local">("local");
  const owner = userId ?? "guest";
  const loading = loadedFor !== owner;

  const refresh = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    try {
      setMembers(await store.list());
    } catch (e) {
      console.warn("Could not load family members:", e);
    }
  }, []);

  useEffect(() => {
    let active = true;
    openFamilyStore(userId).then(async (store) => {
      if (!active) return;
      storeRef.current = store;
      setMode(store.mode);
      await refresh();
      if (active) setLoadedFor(userId ?? "guest");
    });
    return () => {
      active = false;
    };
  }, [userId, refresh]);

  const add = useCallback(async (m: NewMember) => {
    const member = await storeRef.current!.add(m);
    setMembers((prev) => [...prev, member]);
    return member;
  }, []);

  const checkIn = useCallback(async (id: string) => {
    const lastCheckIn = new Date().toISOString();
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, lastCheckIn } : m)));
    await storeRef.current?.update(id, { lastCheckIn });
  }, []);

  const remove = useCallback(async (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    await storeRef.current?.remove(id);
  }, []);

  return (
    <FamilyContext.Provider value={{ members, loading, mode, add, checkIn, remove, refresh }}>
      {children}
    </FamilyContext.Provider>
  );
}

export function useFamily() {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error("useFamily must be used inside FamilyProvider");
  return ctx;
}
