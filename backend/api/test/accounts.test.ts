// Server-side sign-up tests with a MOCKED Supabase Admin API (test-only).
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { emptyWeather } from "../src/weather.js";

const baseConfig: Config = {
  port: 0,
  host: "127.0.0.1",
  workerUrl: "http://worker",
  workerToken: undefined,
  openRouterApiKey: undefined,
  openRouterModel: "m",
  openRouterTimeoutMs: 1000,
  defaultRadiusKm: 15,
  maxRadiusKm: 50,
  weatherCacheTtlMs: 1000,
  weatherStaleAfterMs: 1000,
  corsOrigins: [],
  rateLimitPerMinute: 1000,
  aiRateLimitPerMinute: 1000,
  aiStreamIdleTimeoutMs: 2000,
  aiFirstTokenTimeoutMs: 2000,
  supabaseUrl: "https://proj.supabase.co",
  supabaseServiceKey: "eyJservice",
  signupRateLimitPerHour: 100,
};

type Call = { url: string; headers: Record<string, string>; body: any };

function fakeSupabase(respond: (body: any) => Response) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    return respond(body);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function app(fetchImpl: typeof fetch, over: Partial<Config> = {}) {
  return buildApp({
    config: { ...baseConfig, ...over },
    places: { search: async () => [], get: async () => null },
    weather: { name: "w", fetch: async () => emptyWeather("w") },
    wbgt: { fetch: async () => null },
    satellite: {
      submit: async () => ({ jobId: "x", status: "processing" }),
      getJob: async () => ({ jobId: "x", status: "processing" }),
      tile: async () => new Response(null, { status: 404 }),
      value: async () => ({ insideLayer: false, valueC: null, quality: "none" }),
    },
    accounts: { fetchImpl },
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const signup = { email: " New.User@Example.com ", password: "secret123", fullName: "New User" };

describe("POST /api/v1/auth/signup", () => {
  it("creates an already-confirmed user with the service key kept on the server", async () => {
    const { impl, calls } = fakeSupabase(() => json(200, { id: "user-1", email: "new.user@example.com" }));
    const res = await app(impl).inject({ method: "POST", url: "/api/v1/auth/signup", payload: signup });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ created: true });
    expect(res.payload).not.toContain("eyJservice");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/admin/users");
    expect(calls[0]!.headers.apikey).toBe("eyJservice");
    expect(calls[0]!.headers.Authorization).toBe("Bearer eyJservice");
    expect(calls[0]!.body).toEqual({
      email: "new.user@example.com",
      password: "secret123",
      email_confirm: true,
      user_metadata: { full_name: "New User" },
    });
  });

  it("sends new-style secret keys only in the apikey header", async () => {
    const { impl, calls } = fakeSupabase(() => json(200, { id: "user-2" }));
    await app(impl, { supabaseServiceKey: "sb_secret_abc" }).inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: signup,
    });
    expect(calls[0]!.headers.apikey).toBe("sb_secret_abc");
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("reports an email that is already registered", async () => {
    const { impl } = fakeSupabase(() =>
      json(422, {
        code: 422,
        error_code: "email_exists",
        msg: "A user with this email address has already been registered",
      }),
    );
    const res = await app(impl).inject({ method: "POST", url: "/api/v1/auth/signup", payload: signup });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("email_exists");
  });

  it("validates input before calling Supabase", async () => {
    const { impl, calls } = fakeSupabase(() => json(200, { id: "x" }));
    const res = await app(impl).inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "nope", password: "1" },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 503 and reports status when no service key is configured", async () => {
    const { impl } = fakeSupabase(() => json(200, { id: "x" }));
    const a = app(impl, { supabaseServiceKey: undefined });
    expect((await a.inject({ method: "POST", url: "/api/v1/auth/signup", payload: signup })).statusCode).toBe(503);
    expect((await a.inject({ method: "GET", url: "/api/v1/auth/status" })).json()).toEqual({ signupConfigured: false });
  });

  it("reports a rejected service key as an upstream failure", async () => {
    const { impl } = fakeSupabase(() => json(401, { message: "Invalid API key" }));
    const res = await app(impl).inject({ method: "POST", url: "/api/v1/auth/signup", payload: signup });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain("service key was rejected");
  });
});

describe("POST /api/v1/auth/confirm-existing", () => {
  /** Routes requests by URL: token check, admin user lookup, admin update. */
  function fakeAuth(tokenStatus: number, tokenBody: unknown) {
    const urls: { method: string; url: string; body: any }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      urls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/token?grant_type=password")) return json(tokenStatus, tokenBody);
      if (url.includes("/admin/users?")) return json(200, { users: [{ id: "u-9", email: "old.user@example.com" }] });
      if (url.endsWith("/admin/users/u-9")) return json(200, { id: "u-9" });
      return json(404, {});
    }) as unknown as typeof fetch;
    return { impl, urls };
  }
  const creds = { email: "Old.User@example.com", password: "right-pass" };

  it("confirms an unconfirmed account when the password is right", async () => {
    const { impl, urls } = fakeAuth(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
    const res = await app(impl).inject({ method: "POST", url: "/api/v1/auth/confirm-existing", payload: creds });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confirmed: true });
    const update = urls.find((u) => u.method === "PUT");
    expect(update?.url).toBe("https://proj.supabase.co/auth/v1/admin/users/u-9");
    expect(update?.body).toEqual({ email_confirm: true });
  });

  it("refuses a wrong password without touching the account", async () => {
    const { impl, urls } = fakeAuth(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
    const res = await app(impl).inject({ method: "POST", url: "/api/v1/auth/confirm-existing", payload: creds });
    expect(res.statusCode).toBe(401);
    expect(urls.some((u) => u.method === "PUT")).toBe(false);
    expect(urls.some((u) => u.url.includes("/admin/users"))).toBe(false);
  });

  it("does nothing for an account that is already confirmed", async () => {
    const { impl, urls } = fakeAuth(200, { access_token: "x" });
    const res = await app(impl).inject({ method: "POST", url: "/api/v1/auth/confirm-existing", payload: creds });
    expect(res.statusCode).toBe(200);
    expect(urls).toHaveLength(1);
  });
});
