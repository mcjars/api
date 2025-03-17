ALTER TABLE "user_sessions" ADD COLUMN "ip" "inet" NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "user_agent" varchar(255) NOT NULL;