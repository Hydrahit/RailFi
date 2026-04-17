import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id?: string;
      walletAddress?: string | null;
      kycTier?: number;
      walletLinked?: boolean;
      googleLinked?: boolean;
    };
  }

  interface User {
    walletAddress?: string | null;
    kycTier?: number;
    walletLinked?: boolean;
    googleLinked?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    walletAddress?: string | null;
    kycTier?: number;
    walletLinked?: boolean;
    googleLinked?: boolean;
  }
}
