import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import api, { acceptSession, clearSession, getSession, loginSession, logoutSession, refreshSession } from "../src/services/api";

const user = { id: 1, name: "Personal Mertel", email: "personal@example.com", roles: ["admin"], permissions: ["roles.view"] };
const sessionData = token => ({ access_token: token, user });
function response(config, data = {}, status = 200) {
  return { config, data: { data }, status, statusText: "", headers: {} };
}
function unauthorized(config) {
  return Promise.reject(new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config, {}, response(config, {}, 401)));
}
beforeEach(() => { clearSession(); });
describe("API environment", () => {
  it("rejects missing or unsafe production API configuration", async () => {
    try {
      for (const value of [undefined, "http://localhost:3000", "https://user:password@example.test", "https://api.mertelimportaciones.com/api?key=example"]) {
        vi.resetModules(); vi.stubEnv("PROD", true); vi.stubEnv("VITE_API_URL", value);
        await expect(import("../src/services/api")).rejects.toThrow(/VITE_API_URL/);
      }
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
  it("preserves the production /api compatibility and local development fallback", async () => {
    try {
      for (const [production, value, expected] of [
        [true, "https://api.mertelimportaciones.com", "https://api.mertelimportaciones.com/api"],
        [true, "https://api.mertelimportaciones.com/api/", "https://api.mertelimportaciones.com/api"],
        [false, undefined, "http://localhost:3000/api"],
      ]) {
        vi.resetModules(); vi.stubEnv("PROD", production); vi.stubEnv("VITE_API_URL", value);
        const { default: configuredApi } = await import("../src/services/api");
        expect(configuredApi.defaults.baseURL).toBe(expected);
        expect(configuredApi.defaults.withCredentials).toBe(true);
      }
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
});
describe("centralized authentication", () => {
  it("uses credentials and keeps the session only in memory after login and /me", async () => {
    const requests = [];
    api.defaults.adapter = async config => {
      requests.push(config);
      return response(config, config.url === "/auth/login" ? sessionData("access") : user);
    };
    await loginSession(user.email, "test-password");
    expect(requests.map(config => config.url)).toEqual(["/auth/login", "/auth/me"]);
    expect(JSON.parse(requests[0].data)).toEqual({ email: user.email, password: "test-password" });
    expect(requests.every(config => config.withCredentials)).toBe(true);
    expect(requests[1].headers.get("Authorization")).toBe("Bearer access");
    expect(getSession().user.roles).toEqual(["admin"]);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it("does not refresh incorrect login credentials", async () => {
    const adapter = vi.fn(config => unauthorized(config)); api.defaults.adapter = adapter;
    await expect(loginSession(user.email, "incorrect")).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(1); expect(getSession()).toBeNull();
  });
  it("does not accept login before identity verification succeeds", async () => {
    api.defaults.adapter = config => config.url === "/auth/login" ? Promise.resolve(response(config, sessionData("access"))) : unauthorized(config);
    await expect(loginSession(user.email, "test-password")).rejects.toBeTruthy();
    expect(getSession()).toBeNull();
  });
  it("shares one refresh across concurrent 401s and retries with the new token", async () => {
    acceptSession(sessionData("old")); let refreshes = 0;
    api.defaults.adapter = async config => {
      if (config.url === "/auth/refresh") {
        refreshes += 1;
        await new Promise(resolve => setTimeout(resolve, 15));
        return response(config, sessionData("new"));
      }
      if (config.headers.get("Authorization") === "Bearer old") return unauthorized(config);
      return response(config, { ok: true });
    };
    const results = await Promise.all([api.get("/customers"), api.get("/invoices"), api.get("/portfolio")]);
    expect(refreshes).toBe(1); expect(results.every(result => result.data.data.ok)).toBe(true);
    expect(getSession().accessToken).toBe("new");
  });
  it("clears the session when refresh is rejected without a retry loop", async () => {
    acceptSession(sessionData("expired")); const adapter = vi.fn(config => unauthorized(config)); api.defaults.adapter = adapter;
    await expect(api.get("/customers")).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(2); expect(getSession()).toBeNull();
  });
  it("clears the session if the retried request still returns 401", async () => {
    acceptSession(sessionData("old"));
    const adapter = vi.fn(config => config.url === "/auth/refresh" ? Promise.resolve(response(config, sessionData("new"))) : unauthorized(config));
    api.defaults.adapter = adapter;
    await expect(api.get("/customers")).rejects.toBeTruthy();
    expect(adapter).toHaveBeenCalledTimes(3); expect(getSession()).toBeNull();
  });
  it("does not refresh a permission denial", async () => {
    acceptSession(sessionData("valid"));
    const adapter = vi.fn(config => Promise.reject(new AxiosError("Forbidden", "ERR_BAD_REQUEST", config, {}, response(config, {}, 403))));
    api.defaults.adapter = adapter; await expect(api.get("/admin/roles")).rejects.toBeTruthy();
    expect(adapter).toHaveBeenCalledTimes(1); expect(getSession()).not.toBeNull();
  });
  it("does not expose the Bearer token through a rejected request's diagnostic metadata", async () => {
    const token = "disposable-sensitive-access";
    acceptSession(sessionData(token));
    api.defaults.adapter = config => Promise.reject(new AxiosError("Forbidden", "ERR_BAD_REQUEST", config,
      { diagnosticHeader: config.headers.get("Authorization") }, response(config, {}, 403)));
    const failure = await api.get("/customers").catch(error => error);
    expect(failure.response.status).toBe(403);
    expect(failure.config.headers.get("Authorization")).toBeUndefined();
    expect(failure.response.config.headers.get("Authorization")).toBeUndefined();
    expect(failure.request).toBeUndefined();
    expect(JSON.stringify(failure.toJSON())).not.toContain(token);
    expect(getSession().accessToken).toBe(token);
  });
  it("does not expose the login password through a rejected request's diagnostic metadata", async () => {
    const password = "disposable-sensitive-password";
    api.defaults.adapter = config => unauthorized(config);
    const failure = await loginSession(user.email, password).catch(error => error);
    expect(failure.response.status).toBe(401);
    expect(failure.config.data).toBeUndefined();
    expect(failure.response.config.data).toBeUndefined();
    expect(JSON.stringify(failure.toJSON())).not.toContain(password);
    expect(getSession()).toBeNull();
  });
  it("logs out with credentials and clears memory even on a connection failure", async () => {
    acceptSession(sessionData("access"));
    api.defaults.adapter = async config => {
      expect(config.url).toBe("/auth/logout"); expect(config.withCredentials).toBe(true);
      throw new AxiosError("Network Error", "ERR_NETWORK", config);
    };
    await expect(logoutSession()).rejects.toBeTruthy(); expect(getSession()).toBeNull();
  });
  it("does not restore a session when logout overlaps refresh", async () => {
    acceptSession(sessionData("old")); let finishRefresh;
    api.defaults.adapter = config => config.url === "/auth/refresh" ? new Promise(resolve => {
      finishRefresh = () => resolve(response(config, sessionData("late")));
    }) : Promise.resolve(response(config));
    const refreshing = refreshSession().catch(() => {});
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    const loggingOut = logoutSession(); finishRefresh();
    await Promise.all([refreshing, loggingOut]); expect(getSession()).toBeNull();
  });
  it("waits for a pending logout before starting a new login", async () => {
    acceptSession(sessionData("old")); let finishLogout; const requests = [];
    api.defaults.adapter = config => {
      requests.push(config.url);
      if (config.url === "/auth/logout") return new Promise(resolve => { finishLogout = () => resolve(response(config)); });
      return Promise.resolve(response(config, config.url === "/auth/login" ? sessionData("new") : user));
    };
    const loggingOut = logoutSession();
    await vi.waitFor(() => expect(finishLogout).toBeTypeOf("function"));
    const loggingIn = loginSession(user.email, "test-password");
    expect(requests).toEqual(["/auth/logout"]);
    finishLogout(); await Promise.all([loggingOut, loggingIn]);
    expect(requests).toEqual(["/auth/logout", "/auth/login", "/auth/me"]);
    expect(getSession().accessToken).toBe("new");
  });
});
