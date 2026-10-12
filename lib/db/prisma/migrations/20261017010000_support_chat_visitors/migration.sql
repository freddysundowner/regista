-- Support chat for website visitors: a conversation can belong to a staff member or to a visitor on the landing page.
CREATE TABLE "support_visitors" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_visitors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_visitors_tokenHash_key" ON "support_visitors"("tokenHash");

ALTER TABLE "support_messages" ADD COLUMN "threadId" TEXT, ADD COLUMN "visitorId" UUID;
UPDATE "support_messages" SET "threadId" = 'staff-' || "userId";
ALTER TABLE "support_messages" ALTER COLUMN "threadId" SET NOT NULL,
  ALTER COLUMN "schoolId" DROP NOT NULL, ALTER COLUMN "userId" DROP NOT NULL, ALTER COLUMN "senderId" DROP NOT NULL;
DROP INDEX "support_messages_userId_createdAt_idx";
CREATE INDEX "support_messages_threadId_createdAt_idx" ON "support_messages"("threadId", "createdAt");
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "support_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_messages" DROP CONSTRAINT "support_messages_schoolId_fkey", DROP CONSTRAINT "support_messages_userId_fkey";
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
