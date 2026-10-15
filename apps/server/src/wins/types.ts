export type WinSource = "card" | "pr" | "manual";

export interface Win {
  id: string;
  source: WinSource;
  ref: string;
  title: string;
  at: string;
}
