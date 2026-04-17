# 🎯 RailFi Grant Reviewer Guide

Welcome! This guide shows you how to validate RailFi’s full stack quickly: circuit breaker, Pyth pull-oracle, Helius webhooks/DAS, and Light Protocol ZK compression.

## 🔑 Key Facts
- Program ID: `A7nQnuCfrtBwTdGwgAptFWVE6g2n1b7GGTanc8aToEUt`
- Devnet USDC mint: `UmuRwgXdbLqNUfu8rTFyuFuyPBBV1pPiL5FaR145U5F`
- Pyth feed (USDC/USD): `EF6U755BdHMXim8RBw6XSC6Yk6XaouTKpwcBZ7QkcanB`
- Frontend branch: `codex/phase2-circuit-breaker` commit `22bf7b7`
- Contract branch (circuit breaker + oracle): `codex/phase2-circuit-breaker` commit `662d6d5` (on railpay-contract)

## 🧭 What to Inspect
- **On-chain guards**: `railpay-contract/programs/railpay-contract/src/instructions/request_offramp.rs`  
  - Circuit breaker windowing + trip/reset  
  - Pyth receiver staleness & confidence checks  
- **PDA + events**: `railpay-contract/programs/railpay-contract/src/state.rs`, `events.rs`
- **Webhook ingestion**: `frontend/src/app/api/webhooks/helius/route.ts`
- **Compression bridge**: `frontend/src/app/api/compress-offramp/route.ts`
- **ZK history reader**: `frontend/src/lib/light-rpc.ts`
- **Dashboard integration**: `frontend/src/components/WalletDashboard.tsx`

## 🧪 How to Run the End-to-End Test (10–15 minutes)
1. **Environment**
   - Use Node 18.20.8.  
   - Add `frontend/.env.local` with: `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_APP_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `HELIUS_WEBHOOK_SECRET`, `LIGHT_RPC_URL`, `COMPRESSION_SERVICE_KEYPAIR`, `INTERNAL_API_TOKEN`.
   - Start a tunnel (no account): `ssh -p 443 -R0:localhost:3000 a.pinggy.io` → copy the HTTPS URL into `NEXT_PUBLIC_APP_URL`.
2. **Install & webhook**
   ```bash
   cd /home/hydrahit/frontend
   npm install --legacy-peer-deps
   npm run setup:webhook
   ```
3. **Fund compression wallet**
   ```bash
   npm run fund:compression   # or send ~0.2 SOL to the printed address
   ```
4. **Run app**
   ```bash
   npm run dev
   # open http://localhost:3000
   ```
5. **Trigger offramp**
   - Ensure Pyth rate shows on Transfer form.  
   - Submit an offramp (USDC amount + UPI).  
   - Watch server logs for `[Helius Webhook] Processed offramp...` and `[Compress] Compressed offramp...`.
6. **Verify outputs**
   - **DAS history**: History tab shows recent offramp rows.  
   - **ZK compressed records**: “ZK-Compressed Records” table shows matching entries (owner, USDC, UPI partial, status).  
   - No console floods if Helius drops a request—network layer is hardened.

## 🧠 Backend-Bridge Decision (Phase 5)
- Anchor 0.29.0 + spl-account-compression 0.3.x causes a `solana-program` conflict and BPF stack overflows.
- Instead of CPI-based compression, we offload compression to a backend bridge using `@lightprotocol/stateless.js`:
  - Helius webhook ingests OfframpRequested → calls internal `/api/compress-offramp`
  - Compression service writes a ZK-compressed account with the offramp payload
  - Frontend reads via Light RPC (`getCompressedAccountsByOwner`)
- Result: fully verifiable compressed records, ~1000× cheaper than PDAs, zero Rust dependency risk on Anchor 0.29.0.

## ✅ What “Done” Looks Like
- Circuit breaker trips when outflow exceeds window; admin reset clears it.
- Offramp transaction locks USDC/USD Pyth price; rejects stale/confident feeds.
- Webhook receives Devnet tx, inserts in-memory record, triggers compression call.
- ZK table shows compressed records; DAS history shows tx signatures.
- No unhandled errors in browser console even under RPC throttling.

## 📬 Contact & Disclosure
- Security: `security@railfi.xyz`
- Secrets: stored in env vars only (never committed).
