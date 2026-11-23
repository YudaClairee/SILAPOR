CREATE TABLE "report_supporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_supporters_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "report_supporters_report_reporter_unique" UNIQUE("report_id","reporter_id")
);
--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "supporter_id" uuid;--> statement-breakpoint
ALTER TABLE "report_supporters" ADD CONSTRAINT "report_supporters_report_id_maintenance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_supporters" ADD CONSTRAINT "report_supporters_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_supporters_report_created_idx" ON "report_supporters" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "report_supporters_reporter_created_idx" ON "report_supporters" USING btree ("reporter_id","created_at");--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_supporter_id_report_supporters_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."report_supporters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_reports_asset_status_idx" ON "maintenance_reports" USING btree ("asset_id","status");--> statement-breakpoint
CREATE INDEX "report_attachments_supporter_id_idx" ON "report_attachments" USING btree ("supporter_id");--> statement-breakpoint
-- Data migration: convert legacy SUPPORTING relations (auto-merged REPORTED tickets)
-- into report_supporters rows attached to the primary target ticket.
INSERT INTO "report_supporters" (
	"report_id",
	"reporter_id",
	"idempotency_key",
	"description",
	"created_at"
)
SELECT
	rr."target_report_id",
	src."reporter_id",
	src."idempotency_key",
	src."description",
	src."reported_at"
FROM "report_relations" AS rr
INNER JOIN "maintenance_reports" AS src ON src."id" = rr."source_report_id"
WHERE rr."relation_type" = 'SUPPORTING'
	AND src."status" = 'REPORTED'
	AND src."final_category_id" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "report_attachments" AS ra
SET
	"report_id" = rr."target_report_id",
	"supporter_id" = rs."id"
FROM "report_relations" AS rr
INNER JOIN "maintenance_reports" AS src ON src."id" = rr."source_report_id"
INNER JOIN "report_supporters" AS rs
	ON rs."report_id" = rr."target_report_id"
	AND rs."reporter_id" = src."reporter_id"
WHERE rr."relation_type" = 'SUPPORTING'
	AND src."status" = 'REPORTED'
	AND src."final_category_id" IS NULL
	AND ra."report_id" = src."id";--> statement-breakpoint
UPDATE "staged_uploads" AS su
SET "claimed_report_id" = rr."target_report_id"
FROM "report_relations" AS rr
INNER JOIN "maintenance_reports" AS src ON src."id" = rr."source_report_id"
WHERE rr."relation_type" = 'SUPPORTING'
	AND src."status" = 'REPORTED'
	AND src."final_category_id" IS NULL
	AND su."claimed_report_id" = src."id";--> statement-breakpoint
DELETE FROM "outbox_events" AS oe
USING "report_relations" AS rr, "maintenance_reports" AS src
WHERE oe."type" = 'AI_REVIEW_REQUESTED'
	AND rr."source_report_id" = src."id"
	AND rr."relation_type" = 'SUPPORTING'
	AND src."status" = 'REPORTED'
	AND src."final_category_id" IS NULL
	AND oe."payload"->>'reportId' = src."id"::text;--> statement-breakpoint
WITH "migrated" AS (
	DELETE FROM "report_relations" AS rr
	USING "maintenance_reports" AS src
	WHERE rr."source_report_id" = src."id"
		AND rr."relation_type" = 'SUPPORTING'
		AND src."status" = 'REPORTED'
		AND src."final_category_id" IS NULL
	RETURNING rr."source_report_id"
)
DELETE FROM "maintenance_reports" AS mr
USING "migrated"
WHERE mr."id" = "migrated"."source_report_id";
