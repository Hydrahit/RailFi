import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { verifyWalletSignature } from "@/lib/siws";
import { setProfileFlags } from "@/lib/offramp-store";

const useAdapter = !!process.env.DATABASE_URL;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...(useAdapter ? { adapter: PrismaAdapter(db) } : {}),
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: useAdapter ? "database" : "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
    Credentials({
      id: "siws",
      name: "Solana Wallet",
      credentials: {
        walletAddress: { label: "Wallet address", type: "text" },
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        const walletAddress =
          typeof credentials?.walletAddress === "string" ? credentials.walletAddress.trim() : "";
        const message = typeof credentials?.message === "string" ? credentials.message.trim() : "";
        const signature =
          typeof credentials?.signature === "string" ? credentials.signature.trim() : "";

        if (!walletAddress || !message || !signature) {
          return null;
        }

        if (!verifyWalletSignature(walletAddress, message, signature)) {
          return null;
        }

        await setProfileFlags(walletAddress, { walletLinked: true });

        if (useAdapter) {
          const existing = await db.user.findUnique({ where: { walletAddress } });
          if (existing) {
            return {
              id: existing.id,
              email: existing.email,
              name: existing.name,
              image: existing.image,
              walletAddress,
              kycTier: existing.kycTier,
              walletLinked: true,
              googleLinked: existing.googleLinked,
            };
          }

          const created = await db.user.create({
            data: {
              walletAddress,
              walletLinked: true,
              googleLinked: false,
            },
          });

          return {
            id: created.id,
            email: created.email,
            name: created.name,
            image: created.image,
            walletAddress,
            kycTier: created.kycTier,
            walletLinked: true,
            googleLinked: created.googleLinked,
          };
        }

        return {
          id: walletAddress,
          walletAddress,
          walletLinked: true,
          googleLinked: false,
          kycTier: 0,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.walletAddress = user.walletAddress ?? token.walletAddress ?? null;
        token.kycTier = user.kycTier ?? token.kycTier ?? 0;
        token.walletLinked = user.walletLinked ?? token.walletLinked ?? false;
        token.googleLinked = user.googleLinked ?? token.googleLinked ?? false;
      }
      return token;
    },
    async session({ session, token, user }) {
      session.user.id = user?.id ?? token.sub;
      session.user.walletAddress =
        (typeof user?.walletAddress === "string" ? user.walletAddress : null) ??
        (typeof token.walletAddress === "string" ? token.walletAddress : null);
      session.user.kycTier =
        (typeof user?.kycTier === "number" ? user.kycTier : undefined) ??
        (typeof token.kycTier === "number" ? token.kycTier : undefined) ??
        0;
      session.user.walletLinked =
        (typeof user?.walletLinked === "boolean" ? user.walletLinked : undefined) ??
        (typeof token.walletLinked === "boolean" ? token.walletLinked : undefined) ??
        false;
      session.user.googleLinked =
        (typeof user?.googleLinked === "boolean" ? user.googleLinked : undefined) ??
        (typeof token.googleLinked === "boolean" ? token.googleLinked : undefined) ??
        false;
      return session;
    },
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email && useAdapter) {
        await db.user.upsert({
          where: { email: user.email },
          update: { googleLinked: true, name: user.name, image: user.image },
          create: {
            email: user.email,
            name: user.name,
            image: user.image,
            googleLinked: true,
            walletLinked: !!user.walletAddress,
          },
        });
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
