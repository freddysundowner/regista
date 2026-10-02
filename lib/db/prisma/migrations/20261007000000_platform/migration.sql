CREATE TABLE "platform_tenant_grants" (
 "id" UUID PRIMARY KEY, "actorId" UUID NOT NULL REFERENCES "users"("id"),
 "schoolId" UUID NOT NULL REFERENCES "schools"("id"), "sessionId" TEXT NOT NULL,
 "sessionVersion" INTEGER NOT NULL, "reason" TEXT NOT NULL, "writeEnabled" BOOLEAN NOT NULL DEFAULT false,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ON "platform_tenant_grants" ("actorId","sessionId");
CREATE TABLE "platform_audits" (
 "id" UUID PRIMARY KEY, "actorId" UUID NOT NULL REFERENCES "users"("id"),
 "schoolId" UUID REFERENCES "schools"("id"), "grantId" UUID REFERENCES "platform_tenant_grants"("id"),
 "action" TEXT NOT NULL, "reason" TEXT NOT NULL, "entityId" TEXT, "before" JSONB, "after" JSONB,
 "ip" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ON "platform_audits" ("schoolId","createdAt");