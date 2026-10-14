export interface AiSecurityItem {
  title: string;
  summary: string;
  sourceUrl: string;
  date: string;
}

export interface AiSecurityRoundup {
  /** Monday of the covered week (YYYY-MM-DD). */
  weekOf: string;
  publishedAt: string;
  items: AiSecurityItem[];
}
