DROP INDEX "repos_ws_fullname_uq";--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "provider" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "instance_id" uuid;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "instance_key" text DEFAULT 'github.com' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "namespace_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_instance_id_git_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."git_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repos_ws_instance_path_uq" ON "repos" USING btree ("workspace_id","instance_key","full_name");--> statement-breakpoint
CREATE INDEX "repos_instance_idx" ON "repos" USING btree ("instance_id");