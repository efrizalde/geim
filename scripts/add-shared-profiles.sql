CREATE TABLE IF NOT EXISTS "shared_profiles" (
	"token" text PRIMARY KEY,
	"linked_account_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "shared_profiles_linked_account_id_unique" UNIQUE ("linked_account_id"),
	CONSTRAINT "shared_profiles_linked_account_id_linked_accounts_id_fk"
		FOREIGN KEY ("linked_account_id") REFERENCES "linked_accounts" ("id") ON DELETE CASCADE
);
