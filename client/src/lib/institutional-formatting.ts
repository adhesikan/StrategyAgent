export function formatInstitutionalScore(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(1)).toString();
}