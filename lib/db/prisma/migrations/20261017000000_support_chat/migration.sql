-- Support chat: one conversation per staff member with the platform's support desk.
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "fromSupport" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_messages_userId_createdAt_idx" ON "support_messages"("userId", "createdAt");
CREATE INDEX "support_messages_fromSupport_readAt_idx" ON "support_messages"("fromSupport", "readAt");
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
