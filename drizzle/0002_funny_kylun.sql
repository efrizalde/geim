CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"old_value" boolean NOT NULL,
	"new_value" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"registration_open" boolean DEFAULT true NOT NULL,
	"changed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "owner_password_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION set_registration_policy(desired boolean, actor uuid) RETURNS boolean AS $$
DECLARE previous boolean;
BEGIN
  INSERT INTO admin_settings (key, registration_open) VALUES ('registration', true)
    ON CONFLICT (key) DO NOTHING;
  SELECT registration_open INTO previous FROM admin_settings WHERE key = 'registration' FOR UPDATE;
  IF previous = desired THEN RETURN false; END IF;
  UPDATE admin_settings SET registration_open = desired, changed_by = actor, updated_at = clock_timestamp()
    WHERE key = 'registration';
  INSERT INTO admin_audit (actor_id, old_value, new_value, created_at) VALUES (actor, previous, desired, clock_timestamp());
  RETURN true;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC, id DESC);
