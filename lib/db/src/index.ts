import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const db = new PrismaClient();
export { Prisma } from "@prisma/client";
export type { User, School, FinanceRecord } from "@prisma/client";
