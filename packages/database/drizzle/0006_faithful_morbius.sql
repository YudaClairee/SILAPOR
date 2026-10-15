-- Separate migration (not folded into 0005): 0005 already shipped/applied, so the CHECK lands here.
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_priority_mirror_check" CHECK ("ai_analyses"."priority" IS NOT DISTINCT FROM "ai_analyses"."suggested_priority");
