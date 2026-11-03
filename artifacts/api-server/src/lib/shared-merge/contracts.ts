/**
 * Schema inspection only. Importing schema (not @workspace/db) never opens
 * a database connection. Preparation must not mutate a running app's models.
 */
import * as schema from "@workspace/db/schema";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

export type Origin = "production" | "workspace";
export type Row = Record<string, unknown>;
export interface Contract {
  name: string;
  primaryKey: string;
  numericKey: boolean;
  serialKey: boolean;
  columns: string[];
  columnTypes: Record<string, string>;
  required: string[];
  foreignKeys: { column: string; table: string; targetColumn: string }[];
  uniqueColumns: string[];
  uniqueGroups: string[][];
}
export interface Snapshot {
  origin: Origin;
  identityRealm: string;
  capturedAt: string;
  tables: Record<string, Row[]>;
  sequenceHighWater: Record<string, number>;
}
export interface Decisions {
  epoch: string;
  verifiedAuthIds: string[];
  productionRoleAuthIds: string[];
  archiveWorkspaceRequestIds: number[];
  reviewedSplitRequestIds: number[];
  singletonSources: Record<string, Origin>;
}
export interface Mapping {
  origin: Origin;
  table: string;
  sourceId: string | number;
  targetId: string | number;
}
export interface RequestState {
  id: number;
  origin: Origin;
  sourceId: number;
  recordKey: string;
  archived: boolean;
}
export const SINGLETONS = new Set([
  "review_assignment_defaults", "price_calculator_settings",
  "design_formula_settings", "assembly_formula_settings",
]);
export const NEW_PRICING_TABLES = new Set(["price_calculator_settings", "eto_price_calculator"]);

export function getMergeContracts(): Contract[] {
  const exports: unknown[] = Object.values(schema);
  const tables = exports.filter((value): value is PgTable => is(value, PgTable));
  const logicalName = (name: string) => name === "eto_requests" || name === "eto_price_calculator"
    ? name : name.replace(/^eto_/, "");
  const contracts = tables.map((table): Contract => {
    const config = getTableConfig(table);
    if (config.schema !== "crm" || !config.name.startsWith("eto_")) throw new Error("Unexpected app schema");
    const primary = config.columns.filter((column) => column.primary);
    if (primary.length !== 1) throw new Error("Composite primary keys need explicit review");
    return {
      name: logicalName(config.name),
      primaryKey: primary[0].name,
      numericKey: ["integer", "serial"].includes(primary[0].getSQLType()),
      serialKey: primary[0].getSQLType() === "serial",
      columns: config.columns.map((column) => column.name),
      columnTypes: Object.fromEntries(config.columns.map((column) => [column.name, column.getSQLType()])),
      required: config.columns.filter((column) => column.notNull).map((column) => column.name),
      foreignKeys: [...config.foreignKeys.map((key) => {
        const ref = key.reference();
        if (ref.columns.length !== 1 || ref.foreignColumns.length !== 1) {
          throw new Error("Composite foreign keys need explicit review");
        }
        return {
          column: ref.columns[0].name,
          table: logicalName(getTableName(ref.foreignTable)),
          targetColumn: ref.foreignColumns[0].name,
        };
      }), ...(["design_formula_changes", "assembly_formula_changes"].includes(logicalName(config.name))
        ? [{ column: "actor_user_id", table: "users", targetColumn: "id" }] : [])],
      uniqueColumns: config.columns.filter((column) => column.isUnique).map((column) => column.name),
      uniqueGroups: [
        ...config.uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name)),
        ...config.indexes.filter((index) => index.config.unique).map((index) => index.config.columns.map((column) => {
          if (!("name" in column) || typeof column.name !== "string") {
            throw new Error("Expression unique indexes require explicit review");
          }
          return column.name;
        })),
      ],
    };
  });
  if (contracts.length !== 18) throw new Error("App table inventory changed; review the merge contract");
  return contracts;
}
