import { randomUUID } from "node:crypto";
import type { CsvMapping, NormalizedImportRow } from "./csv";
import { BUDGET_PREVIEW_TTL_MS } from "./constants";

export interface ImportPreviewEntry {
  ownerEmail: string;
  accountId: string;
  fileName: string | null;
  fileSha256: string;
  mapping: CsvMapping;
  invertSign: boolean;
  rows: NormalizedImportRow[];
  expiresAt: number;
}

export class ImportPreviewCache {
  private entries = new Map<string, ImportPreviewEntry>();

  private key(ownerEmail: string, previewId: string): string {
    return `${ownerEmail.toLowerCase()}::${previewId}`;
  }

  put(ownerEmail: string, entry: Omit<ImportPreviewEntry, "expiresAt">): string {
    const previewId = randomUUID();
    this.purgeExpired();
    this.entries.set(this.key(ownerEmail, previewId), { ...entry, expiresAt: Date.now() + BUDGET_PREVIEW_TTL_MS });
    return previewId;
  }

  get(ownerEmail: string, previewId: string): ImportPreviewEntry | undefined {
    this.purgeExpired();
    const row = this.entries.get(this.key(ownerEmail, previewId));
    if (!row || row.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase()) return undefined;
    return row;
  }

  delete(ownerEmail: string, previewId: string): void {
    this.entries.delete(this.key(ownerEmail, previewId));
  }

  purgeExpired(now = Date.now()): void {
    for (const [k, v] of this.entries) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
  }
}

export const importPreviewCache = new ImportPreviewCache();
