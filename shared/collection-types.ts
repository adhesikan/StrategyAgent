/**
 * Research Collections — shared types — Sprint 2.5.1
 *
 * Consumed by server services, routes, and client pages.
 * Collections are a personalization layer on top of Opportunity Intelligence.
 * They store only references — never duplicate opportunity data.
 */

import type { CanonicalOpportunity } from "./opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Collection types
// ---------------------------------------------------------------------------

export type CollectionType = "system" | "user";

export interface CollectionSummary {
  id:             string;
  name:           string;
  description:    string | null;
  collectionType: CollectionType;
  systemKey:      string | null;

  /** Number of current research candidates in this collection. */
  opportunityCount: number;

  /** Symbols explicitly added (user collections only). */
  symbolCount: number;

  isArchived:  boolean;
  isFollowing: boolean;
  isFavorite:  boolean;
  isPinned:    boolean;

  /** Total users following this collection. */
  followCount: number;

  createdAt: string;
  updatedAt: string;
}

export interface CollectionDetail extends CollectionSummary {
  opportunities: CanonicalOpportunity[];
  /** Symbol list (user collections only — system collections are filter-driven). */
  symbols: string[];
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export interface CreateCollectionInput {
  name:        string;
  description?: string;
}

export interface UpdateCollectionInput {
  name?:       string;
  description?: string;
  isArchived?:  boolean;
}

// ---------------------------------------------------------------------------
// List filters / sort
// ---------------------------------------------------------------------------

export type CollectionListSortField =
  | "name"
  | "opportunityCount"
  | "followCount"
  | "createdAt"
  | "updatedAt";

export interface CollectionListOptions {
  /** Filter by type. Omit to return both. */
  collectionType?: CollectionType;
  /** Only return followed collections. */
  followedOnly?: boolean;
  /** Only return favorited collections. */
  favoriteOnly?: boolean;
  /** Only return pinned collections. */
  pinnedOnly?: boolean;
  /** Exclude archived. Default: true. */
  excludeArchived?: boolean;
  /** Text search (name / description). */
  search?: string;
  sortBy?: CollectionListSortField;
  sortDirection?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Symbol-level membership
// ---------------------------------------------------------------------------

export interface SymbolCollectionMembership {
  collectionId:   string;
  collectionName: string;
  collectionType: CollectionType;
  systemKey:      string | null;
  isMember:       boolean;
  isFollowing:    boolean;
  isFavorite:     boolean;
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export interface CollectionHealthSnapshot {
  systemCollectionCount:   number;
  userCollectionCount:     number;
  totalFollows:            number;
  totalFavorites:          number;
  totalPins:               number;
  totalUserSymbols:        number;
  seedingComplete:         boolean;
}
