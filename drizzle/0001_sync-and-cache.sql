CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD COLUMN "sync_locked_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "app_sessions_expires_idx" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inventory_snapshots_account_fetched_idx" ON "inventory_snapshots" USING btree ("linked_account_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "store_snapshots_account_fetched_idx" ON "store_snapshots" USING btree ("linked_account_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tracker_snapshots_account_fetched_idx" ON "tracker_snapshots" USING btree ("linked_account_id","fetched_at" DESC NULLS LAST);