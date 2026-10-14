import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { request as httpRequest } from "node:http";

const ALLOWED_GET = new Set(["/containers/json", "/version"]);

export interface DockerContainerRow {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
}

export interface DockerSnapshot {
  available: boolean;
  reason?: string;
  version?: string;
  containers: DockerContainerRow[];
}

function shortId(id: string): string {
  const s = id.replace(/^sha256:/, "");
  return s.length > 12 ? s.slice(0, 12) : s;
}

function trimImage(img: string): string {
  const at = img.indexOf("@");
  return at > 0 ? img.slice(0, at) : img;
}

export function assertReadOnlyDockerPath(path: string): void {
  const base = path.split("?")[0] ?? path;
  if (!ALLOWED_GET.has(base)) {
    throw new Error(`docker API path not allowed: ${base}`);
  }
}

async function dockerGet(socketPath: string, path: string, timeoutMs = 4000): Promise<string> {
  assertReadOnlyDockerPath(path);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath,
        path,
        method: "GET",
        headers: { Host: "docker", Accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`docker API ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("docker API timeout"));
    });
    req.end();
  });
}

export async function socketReadable(socketPath: string): Promise<boolean> {
  try {
    await access(socketPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function fetchDockerSnapshot(socketPath: string): Promise<DockerSnapshot> {
  if (!(await socketReadable(socketPath))) {
    return { available: false, reason: "Docker socket not readable", containers: [] };
  }
  try {
    let version: string | undefined;
    try {
      const verBody = await dockerGet(socketPath, "/version");
      const ver = JSON.parse(verBody) as { Version?: string };
      version = ver.Version;
    } catch {
      /* optional */
    }
    const raw = await dockerGet(socketPath, "/containers/json?all=1");
    const list = JSON.parse(raw) as Array<{
      Id: string;
      Names?: string[];
      Image: string;
      State: string;
      Status: string;
      Health?: { Status?: string };
    }>;
    const containers: DockerContainerRow[] = list.map((c) => ({
      id: shortId(c.Id),
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
      image: trimImage(c.Image),
      state: c.State,
      status: c.Status,
      health: c.Health?.Status ?? null,
    }));
    containers.sort((a, b) => a.name.localeCompare(b.name));
    return { available: true, version, containers };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "docker unavailable";
    return { available: false, reason, containers: [] };
  }
}
