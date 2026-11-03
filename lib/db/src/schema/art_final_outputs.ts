import { serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";

export const artFinalOutputsTable = crmSchema.table(ETO_TABLE_NAMES.art_final_outputs, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().unique().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  marketPrice: text("market_price"),
  marketPriceCurrency: text("market_price_currency").notNull().default("USD"),
  marketLeadtime: text("market_leadtime"),
  quoteDescription: text("quote_description"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertArtFinalOutput = typeof artFinalOutputsTable.$inferInsert;
export type ArtFinalOutput = typeof artFinalOutputsTable.$inferSelect;
