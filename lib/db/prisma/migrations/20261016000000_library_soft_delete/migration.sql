-- Deleting a book or copy that has been lent hides it instead, so learners' borrowing history keeps the title.
ALTER TABLE "library_books" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "library_copies" ADD COLUMN "deletedAt" TIMESTAMP(3);
