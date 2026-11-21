import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const adminAuditEvents = pgTable("admin_audit_events", {
  id: serial("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
