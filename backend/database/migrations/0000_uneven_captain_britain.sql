CREATE TABLE IF NOT EXISTS "processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"source" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_dlq" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_event_id" uuid NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"failure_reason" text NOT NULL,
	"attempts" integer NOT NULL,
	"failed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saga_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saga_id" uuid NOT NULL,
	"saga_name" varchar(100) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compensated_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"ttl_at" timestamp,
	CONSTRAINT "saga_state_saga_id_unique" UNIQUE("saga_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"sku" varchar(100) NOT NULL,
	"base_price" numeric(15, 2) NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"data" jsonb NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_status_idx" ON "outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_created_at_idx" ON "outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saga_state_status_idx" ON "saga_state" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saga_state_aggregate_idx" ON "saga_state" USING btree ("aggregate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_active_idx" ON "products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_analytics_event_type_idx" ON "plugin_analytics_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_analytics_recorded_at_idx" ON "plugin_analytics_events" USING btree ("recorded_at");