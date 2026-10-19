import { API_BASE_URL } from "./api";

export type ServerSignup = "created" | "exists" | "unavailable" | { error: string };

/**
 * Creates an already-confirmed account through the UrbanHeat Watch API (Supabase service key on the
 * server), so no verification email is involved. "unavailable" means the server can't do this
 * (not configured or not reachable) and the caller should fall back to Supabase's own sign-up.
 */
export async function createAccountOnServer(email: string, password: string, fullName?: string): Promise<ServerSignup> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName: fullName?.trim() || undefined }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return "unavailable";
  }
  if (res.status === 201) return "created";
  if (res.status === 409) return "exists";
  if (res.status === 503 || res.status === 404) return "unavailable";
  const body = await res.json().catch(() => null);
  if (res.status === 429) return { error: "rate limit" };
  return { error: body?.message ?? "Could not create the account." };
}

/**
 * For accounts made while Supabase still required email verification: the API confirms the
 * account after checking the password, so the person can sign in without any email step.
 */
export async function confirmExistingAccount(email: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/confirm-existing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
