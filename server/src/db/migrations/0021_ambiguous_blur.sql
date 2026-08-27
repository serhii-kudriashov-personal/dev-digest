CREATE UNIQUE INDEX "ci_installations_agent_repo_uq" ON "ci_installations" USING btree ("agent_id","repo");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_installation_url_uq" ON "ci_runs" USING btree ("ci_installation_id","github_url");--> statement-breakpoint
CREATE INDEX "ci_runs_installation_ran_idx" ON "ci_runs" USING btree ("ci_installation_id","ran_at" desc);