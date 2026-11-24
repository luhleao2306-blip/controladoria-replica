import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const backgroundW2 = sqliteTable("integration_background_w2", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  companyId: text("company_id").notNull(),
  sessionEncrypted: text("session_encrypted").notNull(),
  progressJson: text("progress_json"),
});

export const backgroundJobs = sqliteTable("integration_background_jobs", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  companyId: text("company_id").notNull(),
  progressJson: text("progress_json"),
  lastFullSyncAt: text("last_full_sync_at"),
  lastFullDueFrom: text("last_full_due_from"),
});
