import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __railpayPrisma: PrismaClient | undefined;
}

export const db =
  global.__railpayPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__railpayPrisma = db;
}
