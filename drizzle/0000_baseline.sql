CREATE TABLE "app_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"linked_account_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"skin_level_ids_json" jsonb NOT NULL,
	"chroma_ids_json" jsonb NOT NULL,
	"buddy_count" integer,
	"matches_json" jsonb,
	"parser_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game" text DEFAULT 'valorant' NOT NULL,
	"puuid" text NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"region" text NOT NULL,
	"shard" text NOT NULL,
	"auth_mode" text DEFAULT 'cookie_jar' NOT NULL,
	"connection_status" text DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sessions" (
	"linked_account_id" uuid PRIMARY KEY NOT NULL,
	"sealed_payload" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"last_renewed_at" timestamp with time zone,
	"renewal_locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_profiles" (
	"token" text PRIMARY KEY NOT NULL,
	"linked_account_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_profiles_linked_account_id_unique" UNIQUE("linked_account_id")
);
--> statement-breakpoint
CREATE TABLE "store_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"linked_account_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"daily_expires_at" timestamp with time zone NOT NULL,
	"bonus_expires_at" timestamp with time zone,
	"offers_json" jsonb NOT NULL,
	"wallet_json" jsonb,
	"parser_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"linked_account_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"profile_json" jsonb NOT NULL,
	"matches_json" jsonb NOT NULL,
	"parser_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_currency" text DEFAULT 'IDR' NOT NULL,
	"purchase_region" text DEFAULT 'ID' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_linked_account_id_linked_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."linked_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sessions" ADD CONSTRAINT "provider_sessions_linked_account_id_linked_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."linked_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_profiles" ADD CONSTRAINT "shared_profiles_linked_account_id_linked_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."linked_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_snapshots" ADD CONSTRAINT "store_snapshots_linked_account_id_linked_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."linked_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_snapshots" ADD CONSTRAINT "tracker_snapshots_linked_account_id_linked_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."linked_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_accounts_owner_game_puuid_idx" ON "linked_accounts" USING btree ("user_id","game","puuid");