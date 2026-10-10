CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_code" text NOT NULL,
	"category_id" uuid,
	"location_id" uuid,
	"name" text NOT NULL,
	"weight" integer DEFAULT 15 NOT NULL,
	"quantity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_assets_asset_code_unique" UNIQUE("asset_code"),
	CONSTRAINT "facility_assets_weight_check" CHECK ("facility_assets"."weight" >= 0 AND "facility_assets"."weight" <= 30)
);
--> statement-breakpoint
CREATE TABLE "facility_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"weight" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "facility_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "facility_categories_weight_check" CHECK ("facility_categories"."weight" >= 0 AND "facility_categories"."weight" <= 40)
);
--> statement-breakpoint
CREATE TABLE "issue_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "issue_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"building_code" text,
	"floor_number" integer,
	"usage_tier" text,
	"tier_score" integer,
	"reporter_hidden" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code"),
	CONSTRAINT "locations_type_check" CHECK ("locations"."type" IN ('CAMPUS', 'BUILDING', 'FLOOR', 'ROOM')),
	CONSTRAINT "locations_tier_score_check" CHECK ("locations"."tier_score" IS NULL OR ("locations"."tier_score" >= 0 AND "locations"."tier_score" <= 30))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "technicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technician_code" text NOT NULL,
	"display_name" text NOT NULL,
	"specialty" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technicians_technician_code_unique" UNIQUE("technician_code")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nim" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_assets" ADD CONSTRAINT "facility_assets_category_id_facility_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."facility_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_assets" ADD CONSTRAINT "facility_assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_types" ADD CONSTRAINT "issue_types_category_id_facility_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."facility_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "facility_assets_location_category_idx" ON "facility_assets" USING btree ("location_id","category_id");--> statement-breakpoint
CREATE INDEX "facility_assets_category_id_idx" ON "facility_assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "facility_assets_is_active_idx" ON "facility_assets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "issue_types_category_id_idx" ON "issue_types" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "issue_types_is_active_idx" ON "issue_types" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "locations_parent_id_idx" ON "locations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "locations_building_code_idx" ON "locations" USING btree ("building_code");--> statement-breakpoint
CREATE INDEX "locations_is_active_idx" ON "locations" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_external_user_id_unique" UNIQUE("external_user_id");