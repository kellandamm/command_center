import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Config } from "./config";

export function cfAccessConfigured(cfg: Config): boolean {
  return Boolean(cfg.cfTeamDomain && cfg.cfAud);
}

export function cfAccessIssuer(cfg: Config): string | null {
  if (!cfg.cfTeamDomain) return null;
  return `https://${cfg.cfTeamDomain}`;
}

export type CfAccessJwtVerifier = (token: string) => Promise<JWTPayload>;

export function createCfAccessJwtVerifier(cfg: Config, getKey: JWTVerifyGetKey): CfAccessJwtVerifier | null {
  const issuer = cfAccessIssuer(cfg);
  const aud = cfg.cfAud;
  if (!issuer || !aud) return null;
  return async (token) => {
    const { payload } = await jwtVerify(token, getKey, { issuer, audience: aud });
    return payload;
  };
}

export function createCfAccessRemoteJwtVerifier(cfg: Config): CfAccessJwtVerifier | null {
  const issuer = cfAccessIssuer(cfg);
  if (!issuer) return null;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return createCfAccessJwtVerifier(cfg, jwks);
}

/** Inbound service token client id from a verified Access JWT (not the raw request header). */
export function serviceTokenClientIdFromPayload(payload: JWTPayload): string | null {
  const cn = payload.common_name;
  if (typeof cn === "string" && cn.trim()) return cn.trim();
  return null;
}

export function accessJwtFromRequest(headers: { [key: string]: string | string[] | undefined }): string | null {
  const jwt = headers["cf-access-jwt-assertion"];
  const token = (Array.isArray(jwt) ? jwt[0] : jwt)?.trim();
  return token || null;
}
