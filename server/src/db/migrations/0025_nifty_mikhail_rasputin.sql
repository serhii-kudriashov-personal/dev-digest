CREATE TABLE "review_postbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"pr_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"notes_published" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_postbacks" ADD CONSTRAINT "review_postbacks_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_postbacks_run_pr_uq" ON "review_postbacks" USING btree ("run_id","pr_id");--> statement-breakpoint
CREATE INDEX "review_postbacks_pr_idx" ON "review_postbacks" USING btree ("pr_id");