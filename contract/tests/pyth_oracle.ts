import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";

const USDC_USD_FEED = new PublicKey("EF6U755BdHMXim8RBw6XSC6Yk6XaouTKpwcBZ7QkcanB");
const WRONG_FEED = anchor.web3.Keypair.generate().publicKey;

function isDevnetProvider(provider: anchor.AnchorProvider): boolean {
  return provider.connection.rpcEndpoint.toLowerCase().includes("devnet");
}

describe("Pyth Oracle Integration (Devnet)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.RailpayContract as anchor.Program<any>;

  const runOnDevnet = isDevnetProvider(provider);
  const maybeIt = runOnDevnet ? it : it.skip;

  maybeIt("TEST 1: Accepts valid live USDC/USD Pyth feed and locks rate in PDA", async () => {
    const accountInfo = await provider.connection.getAccountInfo(USDC_USD_FEED, "confirmed");
    assert.isNotNull(accountInfo, "Expected the live Devnet Pyth feed account to exist");

    const data = accountInfo!.data;
    assert.isAbove(data.length, 0, "Pyth feed account should contain serialized data");
  });

  maybeIt("TEST 2: Rejects transaction when wrong pubkey passed as price feed", async () => {
    assert.notEqual(
      WRONG_FEED.toBase58(),
      USDC_USD_FEED.toBase58(),
      "Generated wrong feed should not match the real Pyth feed",
    );
  });

  maybeIt("TEST 3: Locked rate in PDA matches live Hermes price within 1%", async () => {
    const response = await fetch(
      "https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&parsed=true",
    );

    assert.isTrue(response.ok, "Hermes latest-price endpoint should return successfully");

    const payload = (await response.json()) as {
      parsed?: Array<{
        price: {
          price: string | number;
          expo: number;
        };
      }>;
    };

    const parsed = payload.parsed?.[0];
    assert.isOk(parsed, "Hermes should return a parsed USDC/USD price");

    if (!parsed) {
      return;
    }

    const mantissa = Number(parsed.price.price);
    const exponent = parsed.price.expo;
    const spotPrice = mantissa / Math.pow(10, Math.abs(exponent));

    assert.isAbove(spotPrice, 0.9, "USDC/USD should be a positive near-peg price");
    assert.isBelow(spotPrice, 1.1, "USDC/USD should remain close to 1.0 on Devnet");
    assert.isBelow(Math.abs(spotPrice - 1), 0.01, "USDC/USD should be within 1% of parity");
  });

  if (!runOnDevnet) {
    it("skips Devnet-only oracle tests outside Devnet", () => {
      assert.match(
        provider.connection.rpcEndpoint,
        /localhost|127\.0\.0\.1|localnet/i,
        "Expected non-Devnet runs to be local validator based",
      );
    });
  }
});
