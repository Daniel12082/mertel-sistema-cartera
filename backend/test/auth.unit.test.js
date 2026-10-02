import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { loadAuthConfig } from "../src/config/auth.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import { issueAccessToken, verifyAccessToken } from "../src/services/auth.service.js";
const env = { JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173" };
const config = loadAuthConfig(env);
test("auth requires explicit secret and origin; invalid values fail closed", () => {
  for (const invalid of [{ JWT_SECRET: undefined }, { JWT_SECRET: "short" }, { FRONTEND_URL: "" },
    { FRONTEND_URL: "*" }, { FRONTEND_URL: "http://localhost:5173/path" }, { FRONTEND_URL: "https://user:pass@example.test" },
    { JWT_ACCESS_EXPIRES_IN: "0m" }, { JWT_ACCESS_EXPIRES_IN: "2h" }, { AUTH_REFRESH_EXPIRES_IN: "91d" },
    { AUTH_COOKIE_SAME_SITE: "none" }, { AUTH_RATE_LIMIT_MAX: "0" }, { TRUST_PROXY_HOPS: "true" }, { NODE_ENV: "Production" }]) {
    assert.throws(() => loadAuthConfig({ ...env, ...invalid }));
  }
  assert.equal(config.accessSeconds, 900); assert.equal(config.refreshSeconds, 604800);
});
test("production requires HTTPS origins and Secure HttpOnly cookies", () => {
  assert.throws(() => loadAuthConfig({ ...env, NODE_ENV: "production" }));
  const production = loadAuthConfig({ ...env, NODE_ENV: "production", FRONTEND_URL: "https://mertel.example", AUTH_COOKIE_SAME_SITE: "none" });
  assert.equal(production.cookieOptions.secure, true); assert.equal(production.cookieOptions.httpOnly, true);
  assert.equal(production.cookieOptions.sameSite, "none");
});
test("password hashing uses salted Argon2id; mismatches/legacy formats fail safely", async () => {
  const first = await hashPassword("temporary-test-pass"); const second = await hashPassword("temporary-test-pass");
  assert.match(first, /^\$argon2id\$v=19\$/);
  assert.deepEqual(first.split("$")[3].split(",").sort(), ["m=65536", "p=1", "t=3"]);
  assert.notEqual(first, second); assert.ok(await verifyPassword(first, "temporary-test-pass"));
  assert.equal(await verifyPassword(first, "incorrect"), false);
  assert.equal(await verifyPassword("legacy_plaintext", "legacy_plaintext"), false);
  assert.equal(await verifyPassword("$argon2id$malformed", "incorrect"), false);
});
test("JWT contains only identity and required standard claims", () => {
  const token = issueAccessToken("18446744073709551615", config);
  const claims = jwt.decode(token);
  assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "iss", "sub"]);
  assert.equal(verifyAccessToken(token, config), "18446744073709551615");
  assert.equal(claims.exp - claims.iat, 900);
});
test("JWT rejects wrong algorithm, issuer, audience, signature and missing expiration", () => {
  for (const [payload, options, secret] of [
    [{}, { algorithm: "HS384" }, config.secret], [{}, { issuer: "other" }, config.secret],
    [{}, { audience: "other" }, config.secret], [{}, {}, randomBytes(48).toString("base64url")],
  ]) {
    const token = jwt.sign(payload, secret, { subject: "1", issuer: config.issuer, audience: config.audience, expiresIn: 900, ...options });
    assert.throws(() => verifyAccessToken(token, config));
  }
  const noExpiration = jwt.sign({}, config.secret, { subject: "1", issuer: config.issuer, audience: config.audience });
  assert.throws(() => verifyAccessToken(noExpiration, config));
  const unsigned = jwt.sign({}, "", { algorithm: "none", subject: "1", issuer: config.issuer, audience: config.audience, expiresIn: 900 });
  assert.throws(() => verifyAccessToken(unsigned, config));
});
test("JWT rejects invalid subject, excessive lifetime and expired tokens", () => {
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [{ sub: "0" }, { sub: "18446744073709551616" }, { exp: now + 3600 }, { iat: now - 1000, exp: now - 100 }, { iat: now + 60, exp: now + 900 }]) {
    const token = jwt.sign({ sub: "1", iat: now, exp: now + 900, iss: config.issuer, aud: config.audience, ...claims }, config.secret);
    assert.throws(() => verifyAccessToken(token, config));
  }
});
