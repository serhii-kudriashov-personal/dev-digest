CREATE INDEX "pr_commits_pr_id_idx" ON "pr_commits" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "pr_files_pr_id_idx" ON "pr_files" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_kind_idx" ON "reviews" USING btree ("pr_id","kind");--> statement-breakpoint
CREATE INDEX "reviews_run_id_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_pr_ran_idx" ON "agent_runs" USING btree ("workspace_id","pr_id","ran_at" desc);--> statement-breakpoint
CREATE INDEX "agent_runs_pr_idx" ON "agent_runs" USING btree ("pr_id");