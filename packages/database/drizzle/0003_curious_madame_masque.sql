CREATE TYPE "public"."report_status" AS ENUM('REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR', 'RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE');--> statement-breakpoint
CREATE TABLE "maintenance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reporter_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"asset_id" uuid,
	"submitted_category_id" uuid NOT NULL,
	"submitted_issue_type_id" uuid,
	"final_category_id" uuid,
	"final_issue_type_id" uuid,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"status" "report_status" DEFAULT 'REPORTED' NOT NULL,
	"duplicate_of_report_id" uuid,
	"priority_score" integer,
	"priority_factors" jsonb,
	"final_priority" text,
	"version" integer DEFAULT 1 NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_reports_ticket_number_unique" UNIQUE("ticket_number"),
	CONSTRAINT "maintenance_reports_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "maintenance_reports_priority_score_check" CHECK ("maintenance_reports"."priority_score" IS NULL OR ("maintenance_reports"."priority_score" >= 0 AND "maintenance_reports"."priority_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "report_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"from_value" jsonb,
	"to_value" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_report_id" uuid NOT NULL,
	"target_report_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_relations_source_target_type_unique" UNIQUE("source_report_id","target_report_id","relation_type"),
	CONSTRAINT "report_relations_type_check" CHECK ("report_relations"."relation_type" IN ('SUPPORTING', 'RELATED'))
);
--> statement-breakpoint
CREATE TABLE "ticket_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_asset_id_facility_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."facility_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_submitted_category_id_facility_categories_id_fk" FOREIGN KEY ("submitted_category_id") REFERENCES "public"."facility_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_submitted_issue_type_id_issue_types_id_fk" FOREIGN KEY ("submitted_issue_type_id") REFERENCES "public"."issue_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_final_category_id_facility_categories_id_fk" FOREIGN KEY ("final_category_id") REFERENCES "public"."facility_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_final_issue_type_id_issue_types_id_fk" FOREIGN KEY ("final_issue_type_id") REFERENCES "public"."issue_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_duplicate_of_report_id_maintenance_reports_id_fk" FOREIGN KEY ("duplicate_of_report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_report_id_maintenance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_maintenance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_relations" ADD CONSTRAINT "report_relations_source_report_id_maintenance_reports_id_fk" FOREIGN KEY ("source_report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_relations" ADD CONSTRAINT "report_relations_target_report_id_maintenance_reports_id_fk" FOREIGN KEY ("target_report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_relations" ADD CONSTRAINT "report_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_reports_reporter_reported_idx" ON "maintenance_reports" USING btree ("reporter_id","reported_at");--> statement-breakpoint
CREATE INDEX "maintenance_reports_status_reported_idx" ON "maintenance_reports" USING btree ("status","reported_at");--> statement-breakpoint
CREATE INDEX "maintenance_reports_final_category_idx" ON "maintenance_reports" USING btree ("final_category_id");--> statement-breakpoint
CREATE INDEX "maintenance_reports_submitted_category_idx" ON "maintenance_reports" USING btree ("submitted_category_id");--> statement-breakpoint
CREATE INDEX "maintenance_reports_location_idx" ON "maintenance_reports" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "maintenance_reports_asset_idx" ON "maintenance_reports" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_reports_duplicate_of_idx" ON "maintenance_reports" USING btree ("duplicate_of_report_id");--> statement-breakpoint
CREATE INDEX "maintenance_reports_reporter_asset_status_idx" ON "maintenance_reports" USING btree ("reporter_id","asset_id","status");--> statement-breakpoint
CREATE INDEX "maintenance_reports_resolved_at_idx" ON "maintenance_reports" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "report_attachments_report_id_idx" ON "report_attachments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_events_report_created_idx" ON "report_events" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "report_relations_target_type_idx" ON "report_relations" USING btree ("target_report_id","relation_type");