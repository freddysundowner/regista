-- Platform-wide switch: when off, self-registered schools become active immediately on the free trial.
CREATE TABLE "platform_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "requireRegistrationApproval" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_settings_singleton" CHECK ("id" = 'default')
);
