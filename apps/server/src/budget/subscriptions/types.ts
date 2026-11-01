export type SubscriptionCadence = "weekly" | "monthly" | "yearly";
export type DetectionKind = "standard" | "possible_yearly";
export type SubscriptionSource = "detected" | "manual";

export interface SubscriptionRow {
  id: string;
  payeeNormalized: string;
  displayName: string;
  amountCents: number;
  currency: string;
  cadence: SubscriptionCadence;
  anchorDate: string;
  categoryId: string | null;
  active: boolean;
  source: SubscriptionSource;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionDetectionRow {
  id: string;
  payeeNormalized: string;
  displayName: string;
  amountCents: number;
  cadence: SubscriptionCadence;
  detectionKind: DetectionKind;
  confidence: number;
  sampleDates: string[];
  status: "pending" | "confirmed" | "dismissed";
  dismissedAt: string | null;
  createdAt: string;
  laneKey: string;
}

export interface OutflowCharge {
  date: string;
  amountCents: number;
  payee: string;
  payeeNormalized: string;
}

export const STANDARD_CONFIDENCE_THRESHOLD = 0.7;
export const POSSIBLE_YEARLY_CONFIDENCE_THRESHOLD = 0.45;
