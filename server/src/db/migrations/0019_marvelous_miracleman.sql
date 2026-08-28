CREATE TABLE "multi_agent_run_members" (
	"multi_agent_run_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "multi_agent_run_members_multi_agent_run_id_run_id_pk" PRIMARY KEY("multi_agent_run_id","run_id")
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "learned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "multi_agent_runs" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "multi_agent_run_members" ADD CONSTRAINT "multi_agent_run_members_multi_agent_run_id_multi_agent_runs_id_fk" FOREIGN KEY ("multi_agent_run_id") REFERENCES "public"."multi_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_agent_run_members" ADD CONSTRAINT "multi_agent_run_members_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "multi_agent_run_members_run_idx" ON "multi_agent_run_members" USING btree ("run_id");