CREATE TYPE "public"."question_category" AS ENUM('behavioral', 'technical');--> statement-breakpoint
CREATE TYPE "public"."recording_kind" AS ENUM('video', 'audio');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('pending', 'stored', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('text', 'voice', 'video');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('queued', 'active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."turn_kind" AS ENUM('bank', 'follow_up', 'generated');--> statement-breakpoint
CREATE TYPE "public"."turn_role" AS ENUM('interviewer', 'candidate');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_idx" integer NOT NULL,
	"state_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"seniority" text NOT NULL,
	"competencies" jsonb NOT NULL,
	"keyterms" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_bank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"category" "question_category" NOT NULL,
	"topic" text NOT NULL,
	"text" text NOT NULL,
	"difficulty" integer DEFAULT 2 NOT NULL,
	"follow_up_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "recording_kind" NOT NULL,
	"blob_url" text,
	"size_bytes" bigint NOT NULL,
	"status" "recording_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"mode" "session_mode" DEFAULT 'text' NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"state" jsonb
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"role" "turn_role" NOT NULL,
	"text" text NOT NULL,
	"kind" "turn_kind",
	"source_question_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"audio_ms" integer
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank" ADD CONSTRAINT "question_bank_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_source_question_id_question_bank_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."question_bank"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_session_turn_idx" ON "decisions" USING btree ("session_id","turn_idx");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_slug_idx" ON "jobs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "question_bank_job_idx" ON "question_bank" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "recordings_status_created_idx" ON "recordings" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_job_idx" ON "sessions" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_session_idx_idx" ON "turns" USING btree ("session_id","idx");