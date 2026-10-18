ALTER TABLE "report_updates" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "report_updates" ADD CONSTRAINT "report_updates_condition_check" CHECK ("report_updates"."condition" IS NULL OR "report_updates"."condition" = 'LAPORAN_PALSU');--> statement-breakpoint
ALTER TABLE "report_updates" DROP CONSTRAINT "report_updates_visibility_check";--> statement-breakpoint
ALTER TABLE "report_updates" DROP COLUMN "visibility";
