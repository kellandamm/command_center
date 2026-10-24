import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { createCfAccessJwtVerifier } from "../src/cf-access";
import { loadConfig } from "../src/config";
import { TEST_CF_TEAM } from "./cf-access-jwt";

test("config: CF_ACCESS_AUD accepts comma-separated list", () => {
  const cfg = loadConfig({
    DATA_DIR: "/tmp/x",
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: " aud-one , aud-two ,",
  });
  assert.deepEqual(cfg.cfAud, ["aud-one", "aud-two"]);
  assert.throws(
    () => loadConfig({ DATA_DIR: "/tmp/x", CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM, CF_ACCESS_AUD: "  ,  " }),
    /both/i,
  );
});

test("cf-access JWT: single AUD verifies", async () => {
  const aud = "single-aud-tag";
  const cfg = loadConfig({
    DATA_DIR: "/tmp/x",
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: aud,
  });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = `https://${TEST_CF_TEAM}`;
  const getKey: JWTVerifyGetKey = async () => publicKey;
  const verify = createCfAccessJwtVerifier(cfg, getKey)!;
  const token = await new SignJWT({ email: "u@example.com" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setExpirationTime("1h")
    .sign(privateKey);
  const payload = await verify(token);
  assert.equal(payload.email, "u@example.com");
});

test("cf-access JWT: multiple AUDs accept either and reject a third", async () => {
  const aud1 = "aud-alpha";
  const aud2 = "aud-beta";
  const aud3 = "aud-other";
  const cfg = loadConfig({
    DATA_DIR: "/tmp/x",
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: `${aud1},${aud2}`,
  });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = `https://${TEST_CF_TEAM}`;
  const getKey: JWTVerifyGetKey = async () => publicKey;
  const verify = createCfAccessJwtVerifier(cfg, getKey)!;
  const sign = (audience: string) =>
    new SignJWT({ sub: "svc" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime("1h")
      .sign(privateKey);
  await verify(await sign(aud1));
  await verify(await sign(aud2));
  const wrongAud = await sign(aud3);
  await assert.rejects(() => verify(wrongAud));
});
