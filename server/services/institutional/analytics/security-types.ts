/**
 * Institutional security-position types.
 *
 * The implementation of SEC put/call normalization lives in the existing
 * institutional service boundary. This module gives analytics consumers a
 * domain-owned name without duplicating or changing parser behavior.
 */

export {
  classifySecurityPositionType,
  isCommonEquityPosition,
} from "../security-position";
export type {
  InstitutionalSecurityPositionType,
} from "../security-position";

import type { InstitutionalSecurityPositionType } from "../security-position";

export type SecurityPositionType = InstitutionalSecurityPositionType;