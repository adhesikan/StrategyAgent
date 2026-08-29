/**
 * Institutional scoring domain contract.
 *
 * No scoring model is implemented in this foundation task. Consumers receive
 * a structured result with versioned components once a later task supplies
 * deterministic calculation rules.
 */

import type {
  InstitutionalScoreResult,
  StockAnalyticsQuery,
} from "./types";

export interface InstitutionalScoringService {
  scoreStock(query: StockAnalyticsQuery): Promise<InstitutionalScoreResult>;
}