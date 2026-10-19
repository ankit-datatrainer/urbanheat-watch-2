import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { confirmExistingAccount, createAccountOnServer } from "../lib/accounts";

/** Remembers on this device that the person chose "Continue as guest". */
export const GUEST_KEY = "uhw:guest";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Guests see only the Home screen (satellite map, live heat, sponsor). */
  isGuest: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ data: any; error: Error | null }>;
  signOut: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  /** Leaves guest mode (e.g. to register); the person is sent to the sign-in screen. */
  leaveGuest: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const [{ data, error }, guest] = await Promise.all([
          supabase.auth.getSession(),
          AsyncStorage.getItem(GUEST_KEY).catch(() => null),
        ]);
        if (mounted) {
          if (!error && data.session) {
            setSession(data.session);
            setUser(data.session.user);
          } else if (guest === "1") {
            setIsGuest(true);
          }
        }
      } catch (err) {
        console.warn("Error reading initial Supabase session:", err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /** A signed-in account always replaces guest mode. */
  async function becomeMember(s: Session | null, u: User | null) {
    setSession(s);
    setUser(u);
    setIsGuest(false);
    await AsyncStorage.removeItem(GUEST_KEY).catch(() => {});
  }

  async function signIn(email: string, password: string) {
    try {
      const creds = { email: email.trim(), password };
      let { data, error } = await supabase.auth.signInWithPassword(creds);
      // Accounts made while email verification was still switched on: confirm them, then sign in.
      if (error && /email not confirmed/i.test(error.message)) {
        if (await confirmExistingAccount(creds.email, password)) {
          ({ data, error } = await supabase.auth.signInWithPassword(creds));
        }
      }
      if (error) return { error };
      await becomeMember(data.session, data.user);
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }

  async function signUp(email: string, password: string, fullName?: string) {
    try {
      // Preferred: the API creates an already-confirmed account (no verification email), then we sign in.
      const viaServer = await createAccountOnServer(email.trim(), password, fullName);
      if (viaServer === "created") {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return { data: null, error };
        await becomeMember(data.session, data.user);
        return { data, error: null };
      }
      if (viaServer === "exists") return { data: null, error: new Error("User already registered") };
      if (typeof viaServer === "object") return { data: null, error: new Error(viaServer.error) };

      // Server sign-up isn't configured: fall back to Supabase's own sign-up.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: fullName?.trim() ? { full_name: fullName.trim() } : undefined,
        },
      });
      if (error) return { data: null, error };
      if (data.session) await becomeMember(data.session, data.user);
      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Error during Supabase signOut:", err);
    } finally {
      setSession(null);
      setUser(null);
      setIsGuest(false);
      await AsyncStorage.removeItem(GUEST_KEY).catch(() => {});
    }
  }

  async function continueAsGuest() {
    setIsGuest(true);
    await AsyncStorage.setItem(GUEST_KEY, "1").catch(() => {});
  }

  async function leaveGuest() {
    setIsGuest(false);
    await AsyncStorage.removeItem(GUEST_KEY).catch(() => {});
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isGuest,
        signIn,
        signUp,
        signOut,
        continueAsGuest,
        leaveGuest,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
