ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model_confidence" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "generated_at" timestamp with time zone;