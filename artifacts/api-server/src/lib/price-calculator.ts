import { db, priceCalculatorSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type PricePercentages = { contingencyPercent: string; marginPercent: string };
export const DEFAULT_PRICE_PERCENTAGES: PricePercentages = {
  contingencyPercent: "10",
  marginPercent: "55",
};

export function parsePricePercentages(value: unknown): PricePercentages | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const fields = ["contingencyPercent", "marginPercent"] as const;
  if (fields.some((field) => {
    const raw = input[field];
    return typeof raw !== "string" || !raw.trim() ||
      !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 100;
  })) return null;
  return {
    contingencyPercent: String(Number(input.contingencyPercent)),
    marginPercent: String(Number(input.marginPercent)),
  };
}

export async function getPriceDefaults(client: Pick<typeof db, "select"> = db) {
  const [row] = await client.select().from(priceCalculatorSettingsTable)
    .where(eq(priceCalculatorSettingsTable.id, 1)).limit(1);
  return row
    ? { contingencyPercent: row.contingencyPercent, marginPercent: row.marginPercent, updatedAt: row.updatedAt }
    : { ...DEFAULT_PRICE_PERCENTAGES, updatedAt: null };
}