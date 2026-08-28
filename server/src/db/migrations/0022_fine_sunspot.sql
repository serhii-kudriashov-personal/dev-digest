CREATE TABLE "git_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"instance_key" text NOT NULL,
	"label" text NOT NULL,
	"version" text,
	"edition" text,
	"approval_capability" text DEFAULT 'unknown' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "git_instances" ADD CONSTRAINT "git_instances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_instances" ADD CONSTRAINT "git_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_instances_ws_base_uq" ON "git_instances" USING btree ("workspace_id","base_url");--> statement-breakpoint
CREATE UNIQUE INDEX "git_instances_ws_key_uq" ON "git_instances" USING btree ("workspace_id","instance_key");--> statement-breakpoint
CREATE INDEX "git_instances_ws_idx" ON "git_instances" USING btree ("workspace_id");