ALTER TABLE "maintenance_reports" DROP CONSTRAINT IF EXISTS "maintenance_reports_priority_decided_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "maintenance_reports" ALTER COLUMN "priority_decided_by" TYPE text USING (CASE WHEN "priority_decided_by" IS NULL THEN NULL ELSE 'ADMIN' END);--> statement-breakpoint
ALTER TABLE "maintenance_reports" ADD CONSTRAINT "maintenance_reports_priority_decided_by_check" CHECK ("maintenance_reports"."priority_decided_by" IS NULL OR "maintenance_reports"."priority_decided_by" IN ('AI', 'ADMIN'));
