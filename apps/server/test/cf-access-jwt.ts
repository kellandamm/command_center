import { generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { CfAccessJwtVerifier } from "../src/cf-access";

export const TEST_CF_TEAM = "shiny-sun-dde5.cloudflareaccess.com";
export const TEST_CF_AUD = "command-center-test-aud";
/** Example second Access application AUD (team-update import only). */
export const TEST_CF_TEAM_UPDATE_AUD = "team-update-import-aud";

export interface TestCfAccessKeys {
  verifier: CfAccessJwtVerifier;
  signServiceTokenJwt: (
    commonName: string,
    opts?: { expiresAt?: number; audience?: string | string[] },
  ) => Promise<string>;
  signEmailJwt: (email: string, opts?: { expiresAt?: number; audience?: string | string[] }) => Promise<string>;
}

export async function createTestCfAccessJwt(audiences: string | string[] = TEST_CF_AUD): Promise<TestCfAccessKeys> {
  const aud = audiences;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = `https://${TEST_CF_TEAM}`;
  const verifier: CfAccessJwtVerifier = async (token) => {
    const { payload } = await jwtVerify(token, publicKey, { issuer, audience: aud });
    return payload as JWTPayload;
  };
  const signServiceTokenJwt = async (
    commonName: string,
    opts?: { expiresAt?: number; audience?: string | string[] },
  ) => {
    const builder = new SignJWT({ common_name: commonName })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(opts?.audience ?? aud);
    if (opts?.expiresAt !== undefined) builder.setExpirationTime(opts.expiresAt);
    else builder.setExpirationTime("1h");
    return builder.sign(privateKey);
  };
  const signEmailJwt = async (email: string, opts?: { expiresAt?: number; audience?: string | string[] }) => {
    const builder = new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(opts?.audience ?? aud);
    if (opts?.expiresAt !== undefined) builder.setExpirationTime(opts.expiresAt);
    else builder.setExpirationTime("1h");
    return builder.sign(privateKey);
  };
  return { verifier, signServiceTokenJwt, signEmailJwt };
}
