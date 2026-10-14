import { statfs } from "node:fs/promises";
import os from "node:os";

export interface HostMemory {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface HostDisk {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface HostCpu {
  cores: number;
  loadAvg: [number, number, number];
  /** Rough utilization 0–100 from jiffies delta since last sample; null on first call. */
  usedPercent: number | null;
}

export interface HostMetrics {
  hostname: string;
  uptimeSec: number;
  memory: HostMemory;
  disk: HostDisk | null;
  cpu: HostCpu;
  diskError?: string;
}

let lastCpuSample: { idle: number; total: number; at: number } | null = null;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

/** Estimate CPU busy % from two os.cpus() snapshots. */
export function sampleCpuUsedPercent(now = Date.now()): number | null {
  const cur = cpuTimes();
  if (!lastCpuSample) {
    lastCpuSample = { ...cur, at: now };
    return null;
  }
  const idleDelta = cur.idle - lastCpuSample.idle;
  const totalDelta = cur.total - lastCpuSample.total;
  lastCpuSample = { ...cur, at: now };
  if (totalDelta <= 0) return null;
  const used = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
  return Math.round(used * 10) / 10;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function memoryUsedPercent(total: number, free: number): number {
  if (total <= 0) return 0;
  const used = Math.max(0, total - free);
  return Math.round((used / total) * 1000) / 10;
}

export async function collectHostMetrics(dataDir: string): Promise<HostMetrics> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  let disk: HostDisk | null = null;
  let diskError: string | undefined;
  try {
    const s = await statfs(dataDir);
    const totalBytes = Number(s.bsize) * Number(s.blocks);
    const freeBytes = Number(s.bsize) * Number(s.bavail);
    disk = {
      path: dataDir,
      totalBytes,
      freeBytes,
      usedPercent: memoryUsedPercent(totalBytes, freeBytes),
    };
  } catch (err) {
    diskError = err instanceof Error ? err.message : "disk unavailable";
  }
  const load = os.loadavg();
  return {
    hostname: os.hostname(),
    uptimeSec: Math.floor(os.uptime()),
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedPercent: memoryUsedPercent(totalMem, freeMem),
    },
    disk,
    diskError,
    cpu: {
      cores: os.cpus().length,
      loadAvg: [load[0], load[1], load[2]],
      usedPercent: sampleCpuUsedPercent(),
    },
  };
}
