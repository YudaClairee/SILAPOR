CREATE TYPE "public"."ai_analysis_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"status" "ai_analysis_status" DEFAULT 'PENDING' NOT NULL,
	"verification_recommendation" text,
	"category" text,
	"issue_type" text,
	"priority" text,
	"possible_duplicate" boolean,
	"suggested_priority" text,
	"risk_factors" jsonb,
	"impact_factors" jsonb,
	"confidence" real,
	"reasoning_summary" text,
	"gateway" text DEFAULT 'openrouter' NOT NULL,
	"upstream_provider" text,
	"model" text NOT NULL,
	"gateway_request_id" text,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"privacy_mode" text DEFAULT 'ZDR' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" real,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_report_id_maintenance_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."maintenance_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_report_id_idx" ON "ai_analyses" USING btree ("report_id");