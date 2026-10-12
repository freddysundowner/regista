-- One-time links emailed to people who forgot their password. Only a hash of the link's token is kept.
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");
CREATE INDEX "password_resets_userId_createdAt_idx" ON "password_resets"("userId", "createdAt");
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
