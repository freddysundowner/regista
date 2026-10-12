-- Knowledge base the support assistant answers from, edited by the platform owner.
CREATE TABLE "knowledge_articles" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);
-- Replies written by the assistant rather than a person.
ALTER TABLE "support_messages" ADD COLUMN "byAi" BOOLEAN NOT NULL DEFAULT false;
