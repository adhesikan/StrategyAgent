import { storage } from "../storage";
import type { TickerUniverse, TickerUniverseMember } from "@shared/schema";

export type UniverseWithMembers = TickerUniverse & { members: TickerUniverseMember[] };

export async function listUniverses(userId: string): Promise<UniverseWithMembers[]> {
  const universes = await storage.getTickerUniverses(userId);
  const results: UniverseWithMembers[] = [];
  for (const u of universes) {
    const members = await storage.getTickerUniverseMembers(u.id);
    results.push({ ...u, members });
  }
  return results;
}

export async function getUniverse(universeId: string, userId: string): Promise<UniverseWithMembers | null> {
  const universe = await storage.getTickerUniverse(universeId, userId);
  if (!universe) return null;
  const members = await storage.getTickerUniverseMembers(universe.id);
  return { ...universe, members };
}

export async function createUniverse(
  userId: string,
  name: string,
  symbols: string[],
  description?: string,
): Promise<UniverseWithMembers> {
  const universe = await storage.createTickerUniverse({ userId, name, description: description ?? null });
  const members = await storage.setTickerUniverseMembers(universe.id, symbols);
  return { ...universe, members };
}

export async function updateUniverse(
  universeId: string,
  userId: string,
  name: string,
  symbols: string[],
  description?: string,
): Promise<UniverseWithMembers | null> {
  const existing = await storage.getTickerUniverse(universeId, userId);
  if (!existing) return null;
  const updated = await storage.updateTickerUniverse(universeId, { name, description: description ?? null });
  if (!updated) return null;
  const members = await storage.setTickerUniverseMembers(universeId, symbols);
  return { ...updated, members };
}

export async function deleteUniverse(universeId: string, userId: string): Promise<boolean> {
  const existing = await storage.getTickerUniverse(universeId, userId);
  if (!existing) return false;
  await storage.deleteTickerUniverse(universeId);
  return true;
}

const DEV_SEED_UNIVERSE = {
  name: "MyTech",
  symbols: ["AAPL", "MSFT", "NVDA", "TSLA", "META"],
};

export async function seedDefaultUniverse(userId: string): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  const existing = await storage.getTickerUniverses(userId);
  if (existing.length > 0) return;
  await createUniverse(userId, DEV_SEED_UNIVERSE.name, DEV_SEED_UNIVERSE.symbols, "Default tech universe for development");
}
