import { z } from "zod";

// Account creation through the Supabase Admin API. The service-role key stays on this server.
// Accounts are created already confirmed, so no verification email is sent (Supabase's built-in
// mailer allows only a few emails per hour) and the app can sign the person in straight away.

export const signupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(6).max(72),
  fullName: z.string().trim().max(80).optional(),
});

export type SignupResult =
  | { status: "created"; userId: string }
  | { status: "exists" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

export type AccountDeps = {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
};

export async function createConfirmedUser(
  input: z.infer<typeof signupBody>,
  deps: AccountDeps,
  signal?: AbortSignal,
): Promise<SignupResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const headers: Record<string, string> = { apikey: deps.serviceKey, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only in apikey.
  if (deps.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${deps.serviceKey}`;

  let res: Response;
  try {
    res = await doFetch(`${deps.supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: input.fullName ? { full_name: input.fullName } : {},
      }),
      signal: signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    return { status: "error", message: "Could not reach the account service." };
  }

  const body = (await res.json().catch(() => null)) as {
    id?: string;
    code?: string;
    error_code?: string;
    msg?: string;
    message?: string;
  } | null;
  if (res.ok && body?.id) return { status: "created", userId: body.id };

  const code = body?.error_code ?? body?.code ?? "";
  const message = body?.msg ?? body?.message ?? "";
  if (code === "email_exists" || /already (been )?registered|already exists/i.test(message))
    return { status: "exists" };
  if (res.status === 400 || res.status === 422)
    return { status: "invalid", message: message || "Invalid email or password." };
  if (res.status === 401 || res.status === 403) {
    return { status: "error", message: "The server's Supabase service key was rejected." };
  }
  return { status: "error", message: message || "Could not create the account." };
}

export const confirmBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72),
});

export type ConfirmResult = "confirmed" | "already_confirmed" | "invalid_credentials" | { error: string };

function adminHeaders(serviceKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  return headers;
}

/**
 * Confirms an older account that was created while Supabase still required email verification.
 * The password is checked first: Supabase only answers "email_not_confirmed" after the password
 * matched, so nobody can confirm an account without knowing its password.
 */
export async function confirmExistingUser(
  input: z.infer<typeof confirmBody>,
  deps: AccountDeps,
): Promise<ConfirmResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.supabaseUrl.replace(/\/$/, "");
  const headers = adminHeaders(deps.serviceKey);
  const signal = AbortSignal.timeout(15000);

  try {
    const login = await doFetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: input.email, password: input.password }),
      signal,
    });
    if (login.ok) return "already_confirmed";
    const err = (await login.json().catch(() => null)) as { error_code?: string; code?: string } | null;
    const code = err?.error_code ?? err?.code;
    if (code !== "email_not_confirmed") return "invalid_credentials";

    const list = await doFetch(`${base}/auth/v1/admin/users?per_page=50&filter=${encodeURIComponent(input.email)}`, {
      headers,
      signal,
    });
    const body = (await list.json().catch(() => null)) as { users?: { id: string; email?: string }[] } | null;
    const user = body?.users?.find((u) => u.email?.toLowerCase() === input.email);
    if (!list.ok || !user) return { error: "Could not find the account." };

    const update = await doFetch(`${base}/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ email_confirm: true }),
      signal,
    });
    return update.ok ? "confirmed" : { error: "Could not confirm the account." };
  } catch {
    return { error: "Could not reach the account service." };
  }
}
