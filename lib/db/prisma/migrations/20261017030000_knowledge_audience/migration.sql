-- Who an article is for: website visitors deciding whether to use Rejista, school staff using it, or both.
ALTER TABLE "knowledge_articles" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'all';
