"use client";

import { useCallback, useEffect, useState } from "react";
import type { Connection, PublicKey } from "@solana/web3.js";
import {
  decodeProtocolConfigAccount,
  formatProtocolConfigError,
  toProtocolConfigDisplay,
  type ProtocolConfigKeys,
} from "@/lib/railpay/protocol";
import type { ProtocolConfigDisplay } from "@/types/railpay";

interface UseRailpayProtocolParams {
  connection: Connection;
  protocolConfigPda: PublicKey;
}

interface UseRailpayProtocolReturn {
  protocolConfig: ProtocolConfigDisplay | null;
  protocolConfigKeys: ProtocolConfigKeys | null;
  protocolConfigError: string | null;
  isProtocolConfigLoading: boolean;
  hasLoadedProtocolConfig: boolean;
  refreshProtocolConfig: () => Promise<void>;
}

export function useRailpayProtocol({
  connection,
  protocolConfigPda,
}: UseRailpayProtocolParams): UseRailpayProtocolReturn {
  const [protocolConfig, setProtocolConfig] = useState<ProtocolConfigDisplay | null>(null);
  const [protocolConfigKeys, setProtocolConfigKeys] = useState<ProtocolConfigKeys | null>(null);
  const [protocolConfigError, setProtocolConfigError] = useState<string | null>(null);
  const [isProtocolConfigLoading, setIsProtocolConfigLoading] = useState(false);
  const [hasLoadedProtocolConfig, setHasLoadedProtocolConfig] = useState(false);

  const refreshProtocolConfig = useCallback(async () => {
    setIsProtocolConfigLoading(true);

    try {
      const rawAccount = await connection.getAccountInfo(protocolConfigPda, "confirmed");
      if (!rawAccount) {
        throw new Error("Protocol config account is missing.");
      }

      const fetchedConfig = decodeProtocolConfigAccount(Buffer.from(rawAccount.data));
      setProtocolConfig(toProtocolConfigDisplay(fetchedConfig));
      setProtocolConfigKeys(fetchedConfig);
      setProtocolConfigError(null);
    } catch (error: unknown) {
      setProtocolConfig(null);
      setProtocolConfigKeys(null);
      setProtocolConfigError(formatProtocolConfigError(error));
    } finally {
      setIsProtocolConfigLoading(false);
      setHasLoadedProtocolConfig(true);
    }
  }, [connection, protocolConfigPda]);

  useEffect(() => {
    setHasLoadedProtocolConfig(false);
    void refreshProtocolConfig();
  }, [refreshProtocolConfig]);

  return {
    protocolConfig,
    protocolConfigKeys,
    protocolConfigError,
    isProtocolConfigLoading,
    hasLoadedProtocolConfig,
    refreshProtocolConfig,
  };
}
