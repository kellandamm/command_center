import { generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { CfAccessJwtVerifier } from "../src/cf-access";

export const TEST_CF_TEAM = "shiny-sun-dde5.cloudflareaccess.com";
export const TEST_CF_AUD = "command-center-test-aud";

export interface TestCfAccessKeys {
  verifier: CfAccessJwtVerifier;
  signServiceTokenJwt: (commonName: string, opts?: { expiresAt?: number }) => Promise<string>;
}

export async function createTestCfAccessJwt(): Promise<TestCfAccessKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = `https://${TEST_CF_TEAM}`;
  const verifier: CfAccessJwtVerifier = async (token) => {
    const { payload } = await jwtVerify(token, publicKey, { issuer, audience: TEST_CF_AUD });
    return payload as JWTPayload;
  };
  const signServiceTokenJwt = async (commonName: string, opts?: { expiresAt?: number }) => {
    const builder = new SignJWT({ common_name: commonName })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(TEST_CF_AUD);
    if (opts?.expiresAt !== undefined) builder.setExpirationTime(opts.expiresAt);
    else builder.setExpirationTime("1h");
    return builder.sign(privateKey);
  };
  return { verifier, signServiceTokenJwt };
}
