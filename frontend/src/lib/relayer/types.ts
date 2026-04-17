export interface InitializeVaultRelayAction {
  kind: "initialize_vault";
  userPubkey: string;
  upiId: string;
}

export interface DepositUsdcRelayAction {
  kind: "deposit_usdc";
  userPubkey: string;
  amountMicroUsdc: string;
}

export interface TriggerOfframpRelayAction {
  kind: "trigger_offramp";
  userPubkey: string;
  amountMicroUsdc: string;
  upiId: string;
  inrPaise: string;
  referralPubkey?: string | null;
}

export type RelayAction =
  | InitializeVaultRelayAction
  | DepositUsdcRelayAction
  | TriggerOfframpRelayAction;

export interface RelayPrepareResponse {
  serializedTransaction: string;
  lastValidBlockHeight: number;
}

export interface RelaySubmitResponse {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  payoutTransferId?: string | null;
}
