CREATE TABLE "report_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"technician_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "report_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"visibility" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_updates_visibility_check" CHECK ("report_updates"."visibility" IN ('PUBLIC', 'INTERNAL'))
);
--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD COLUMN "priority_override_reason" text;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD COLUMN "priority_decided_by" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD COLUMN "priority_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD COLUMN "scoring_config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_report_id_maintenance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_technician_id_technicians_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technicians"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assignments" ADD CONSTRAINT "report_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_updates" ADD CONSTRAINT "report_updates_report_id_maintenance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_updates" ADD CONSTRAINT "report_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_assignments_report_assigned_idx" ON "report_assignments" USING btree ("report_id","assigned_at");--> statement-breakpoint
CREATE INDEX "report_assignments_report_id_idx" ON "report_assignments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_updates_report_created_idx" ON "report_updates" USING btree ("report_id","created_at");--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_priority_decided_by_users_id_fk" FOREIGN KEY ("priority_decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;