# Security Policy

## Responsible Disclosure

Please report security issues privately to [security@railfi.xyz](mailto:security@railfi.xyz).

Include the affected route, component, and reproduction steps whenever possible.

## In Scope

- wallet connection flows
- transaction construction and account wiring
- client-side handling of protocol state

## Out of Scope

- cosmetic UI bugs that do not affect funds or transaction correctness
- third-party infrastructure incidents involving Helius or Pyth

## Circuit Breaker

Frontend flows that surface new outflow actions should account for protocol pause states once the on-chain circuit breaker is introduced.

## Admin Authority Model

Administrative authority is enforced on-chain. The frontend should only surface admin actions to the correct wallet and must never assume authority without reading protocol state.

## Secrets Handling

No deploy keypairs or signing secrets belong in the frontend repository. Sensitive credentials should stay in GitHub Secrets or server-side configuration only.
