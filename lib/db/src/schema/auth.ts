import { index, jsonb, timestamp, varchar } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";

// Persistent browser session storage for application authentication.
export const sessionsTable = crmSchema.table(
  ETO_TABLE_NAMES.sessions,
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("eto_IDX_session_expire").on(table.expire)],
);

export type Session = typeof sessionsTable.$inferSelect;