DROP INDEX IF EXISTS "configValues_unique_config_value_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "configValues_unique_config_sha512_idx" ON "config_values" USING btree ("config_id","sha512");