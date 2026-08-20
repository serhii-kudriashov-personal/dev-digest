CREATE TABLE "eval_set_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"config_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"covered_case_ids" jsonb NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"incomplete_reason" text,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cases_passed" integer DEFAULT 0 NOT NULL,
	"cases_covered" integer DEFAULT 0 NOT NULL,
	"cases_done" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"duration_ms" integer,
	"detail_pruned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation_kind" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expect_file" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expect_start_line" integer;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expect_end_line" integer;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_pr_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_pr_number" integer;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_repo_full_name" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_head_sha" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "run_on_save" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "set_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "grounding_dropped" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "matched" boolean;--> statement-breakpoint
ALTER TABLE "eval_set_runs" ADD CONSTRAINT "eval_set_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_set_runs" ADD CONSTRAINT "eval_set_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_set_runs_ws_agent_ran_idx" ON "eval_set_runs" USING btree ("workspace_id","agent_id","ran_at" desc);--> statement-breakpoint
CREATE INDEX "eval_set_runs_ws_ran_idx" ON "eval_set_runs" USING btree ("workspace_id","ran_at" desc);--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_run_id_eval_set_runs_id_fk" FOREIGN KEY ("set_run_id") REFERENCES "public"."eval_set_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_ws_owner_idx" ON "eval_cases" USING btree ("workspace_id","owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "eval_runs_case_ran_idx" ON "eval_runs" USING btree ("case_id","ran_at" desc);--> statement-breakpoint
CREATE INDEX "eval_runs_set_run_idx" ON "eval_runs" USING btree ("set_run_id");