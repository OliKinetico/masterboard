import type { PipelineColumn, Tier } from "@/lib/domain";

/** Card-level deal shape shared by the kanban board and list view. */
export interface PipelineDeal {
  id: string;
  name: string;
  pipeline_column: PipelineColumn;
  tier: Tier | null;
  owner_user_id: string | null;
  owner_name: string | null;
  region: string | null;
  disciplines: string[];
  score: number | null;
  revenue_estimate: number | null;
  latest_offer_ev: number | null;
  next_action: string | null;
  next_action_due: string | null;
  reengage_on: string | null;
  days_in_column: number | null;
  updated_at: string;
  has_ch_signal: boolean;
}

export interface ColumnSummary {
  column: PipelineColumn;
  probability: number;
  count: number;
  weightedValue: number;
}
