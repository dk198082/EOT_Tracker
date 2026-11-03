import { db, assemblyFormulaSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseDesignFormula, type DesignFormula } from "./design-formula";
import { calculateWholeCost } from "./money";

export type AssemblyFormula = DesignFormula;
export const parseAssemblyFormula = parseDesignFormula;

export const DEFAULT_ASSEMBLY_FORMULA: AssemblyFormula = {
  hourlyRate: "70",
  hoursPerWeek: "40",
  capacityFactor: "0.65",
};

export async function getAssemblyFormula(): Promise<AssemblyFormula & { updatedAt: Date | null }> {
  const [row] = await db.select().from(assemblyFormulaSettingsTable)
    .where(eq(assemblyFormulaSettingsTable.id, 1)).limit(1);
  return row
    ? { hourlyRate: row.hourlyRate, hoursPerWeek: row.hoursPerWeek, capacityFactor: row.capacityFactor, updatedAt: row.updatedAt }
    : { ...DEFAULT_ASSEMBLY_FORMULA, updatedAt: null };
}

export function calculateAssemblyEstimate(hours: string, formula: AssemblyFormula) {
  const assemblyCost = Number(hours) * Number(formula.hourlyRate);
  const assemblyLeadTimeWeeks = Number(hours) / Number(formula.hoursPerWeek) / Number(formula.capacityFactor);
  if (!Number.isFinite(assemblyCost) || !Number.isFinite(assemblyLeadTimeWeeks) ||
      assemblyCost < 0 || assemblyLeadTimeWeeks < 0) {
    throw new RangeError("Assembly estimate is outside the supported numeric range");
  }
  return {
    assemblyCost: calculateWholeCost(hours, formula.hourlyRate),
    assemblyCostCurrency: "USD",
    assemblyLeadTimeWeeks: assemblyLeadTimeWeeks.toFixed(2),
    assemblyHourlyRate: formula.hourlyRate,
    assemblyHoursPerWeek: formula.hoursPerWeek,
    assemblyCapacityFactor: formula.capacityFactor,
  };
}