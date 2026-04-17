import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

declare global {
  // eslint-disable-next-line no-var
  var __railpayPrisma: PrismaClient | undefined;
}

const prismaBase =
  global.__railpayPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

export const db: PrismaClient = (process.env.PRISMA_ACCELERATE_URL?.trim()
  ? prismaBase.$extends(withAccelerate())
  : prismaBase) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  global.__railpayPrisma = prismaBase;
}
