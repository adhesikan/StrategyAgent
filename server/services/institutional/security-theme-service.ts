/**
 * Synchronizes the existing curated theme registry into normalized storage.
 *
 * Theme definitions remain owned by the registry/configuration layer. This
 * service only persists definitions and creates many-to-many memberships for
 * already-known security_master rows; it does not infer themes from names.
 */

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "../../db";
import {
  securityMaster,
  securityMasterThemes,
  securityThemes,
  institutionalSecurityMappings,
} from "@shared/schema";
import { getAllThemes } from "../../config/theme-registry";
import { buildCuratedSecurityThemeMemberships } from "./security-theme-mapping";

export interface SecurityThemeSyncResult {
  themesUpserted: number;
  membershipsRebuilt: number;
}

export async function syncSecurityThemesFromRegistry(): Promise<SecurityThemeSyncResult> {
  const definitions = getAllThemes();
  let themesUpserted = 0;

  for (const theme of definitions) {
    await db
      .insert(securityThemes)
      .values({
        themeId: theme.themeId,
        name: theme.name,
        description: theme.description,
        classificationMethod: theme.classificationMethod,
        active: theme.active,
      })
      .onConflictDoUpdate({
        target: securityThemes.themeId,
        set: {
          name: theme.name,
          description: theme.description,
          classificationMethod: theme.classificationMethod,
          active: theme.active,
          updatedAt: new Date(),
        },
      });
    themesUpserted++;
  }

  const masters = await db
    .selectDistinct({ id: securityMaster.id, ticker: securityMaster.ticker })
    .from(securityMaster)
    .leftJoin(
      institutionalSecurityMappings,
      eq(institutionalSecurityMappings.cusip, securityMaster.cusip),
    )
    .where(
      and(
        isNotNull(securityMaster.ticker),
        or(
          eq(securityMaster.reviewStatus, "reviewed"),
          and(
            inArray(institutionalSecurityMappings.mappingStatus, ["exact", "reviewed"]),
            eq(institutionalSecurityMappings.mappedSymbol, securityMaster.ticker),
          ),
        ),
      ),
    );

  let membershipsRebuilt = 0;
  const trustedMasterIds = masters.map((master) => master.id);
  if (trustedMasterIds.length > 0) {
    await db
      .delete(securityMasterThemes)
      .where(
        and(
          inArray(securityMasterThemes.securityMasterId, trustedMasterIds),
          eq(securityMasterThemes.source, "theme-registry"),
        ),
      );
  }

  const memberships = buildCuratedSecurityThemeMemberships(masters, definitions);

  const batchSize = 500;
  for (let index = 0; index < memberships.length; index += batchSize) {
    const batch = memberships.slice(index, index + batchSize);
    await db
      .insert(securityMasterThemes)
      .values(batch)
      .onConflictDoNothing();
    membershipsRebuilt += batch.length;
  }

  return { themesUpserted, membershipsRebuilt };
}