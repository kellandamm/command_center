export interface StaleCandidate {
  id: string;
  title: string;
  href: string;
  untouchedDays: number;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDay(dayYmd: string): number {
  let h = 2166136261;
  for (let i = 0; i < dayYmd.length; i++) {
    h ^= dayYmd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickRediscover(candidates: StaleCandidate[], dayYmd: string, limit: number): StaleCandidate[] {
  if (candidates.length <= limit) return [...candidates];
  const rand = mulberry32(seedFromDay(dayYmd));
  const pool = [...candidates];
  const picked: StaleCandidate[] = [];
  while (picked.length < limit && pool.length) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

export function daysBetween(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((nowMs - t) / 86_400_000);
}
