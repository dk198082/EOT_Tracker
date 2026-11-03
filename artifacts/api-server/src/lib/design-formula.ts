import { db, designFormulaSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isWholeMoney, calculateWholeCost } from "./money";

export type DesignFormula = {
  hourlyRate: string;
  hoursPerWeek: string;
  capacityFactor: string;
};

export const DEFAULT_DESIGN_FORMULA: DesignFormula = {
  hourlyRate: "100",
  hoursPerWeek: "40",
  capacityFactor: "0.35",
};

export async function getDesignFormula(): Promise<DesignFormula & { updatedAt: Date | null }> {
  const [row] = await db.select().from(designFormulaSettingsTable)
    .where(eq(designFormulaSettingsTable.id, 1)).limit(1);
  return row
    ? { hourlyRate: row.hourlyRate, hoursPerWeek: row.hoursPerWeek, capacityFactor: row.capacityFactor, updatedAt: row.updatedAt }
    : { ...DEFAULT_DESIGN_FORMULA, updatedAt: null };
}

export function parseDesignFormula(value: unknown): DesignFormula | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const fields = ["hourlyRate", "hoursPerWeek", "capacityFactor"] as const;
  if (fields.some((field) => typeof input[field] !== "string" || !(input[field] as string).trim())) return null;

  const formula = {
    hourlyRate: (input.hourlyRate as string).trim(),
    hoursPerWeek: (input.hoursPerWeek as string).trim(),
    capacityFactor: (input.capacityFactor as string).trim(),
  };
  const rate = Number(formula.hourlyRate);
  const week = Number(formula.hoursPerWeek);
  const factor = Number(formula.capacityFactor);
  if (!isWholeMoney(formula.hourlyRate) || !Number.isFinite(rate) || rate <= 0 || rate > 1_000_000_000 ||
      !Number.isFinite(week) || week < 1 || week > 168 ||
      !Number.isFinite(factor) || factor < 0.01 || factor > 1) return null;
  return formula;
}

export function calculateDesignEstimate(hours: string, formula: DesignFormula) {
  const designCost = Number(hours) * Number(formula.hourlyRate);
  const designLeadTimeWeeks = Number(hours) / Number(formula.hoursPerWeek) / Number(formula.capacityFactor);
  if (!Number.isFinite(designCost) || !Number.isFinite(designLeadTimeWeeks) ||
      designCost < 0 || designLeadTimeWeeks < 0) {
    throw new RangeError("Design estimate is outside the supported numeric range");
  }
  return {
    designCost: calculateWholeCost(hours, formula.hourlyRate),
    designLeadTimeWeeks: designLeadTimeWeeks.toFixed(2),
    designHourlyRate: formula.hourlyRate,
    designHoursPerWeek: formula.hoursPerWeek,
    designCapacityFactor: formula.capacityFactor,
  };
}