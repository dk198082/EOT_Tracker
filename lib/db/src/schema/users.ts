import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const usersTable = crmSchema.table(ETO_TABLE_NAMES.users, {
  id: serial("id").primaryKey(),
  // The physical column keeps its historical name so existing role and ETO
  // records survive the auth-provider migration without a destructive rename.
  // Nullable so admins can pre-create users before they first sign in.
  // The physical column keeps the historical name to avoid a destructive rename.
  authId: text("clerk_id").unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("sales"), // none | sales | art | engineering | production | admin | superuser
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectUserSchema = createSelectSchema(usersTable);

export type InsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
