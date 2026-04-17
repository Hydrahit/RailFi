# Security Policy

## Responsible Disclosure

Please report security issues privately to [security@railpay.xyz](mailto:security@railpay.xyz).

Include the affected component, reproduction steps, and expected impact whenever possible.

## In Scope

- Anchor program logic
- on-chain PDA derivations
- smart contract state transitions

## Out of Scope

- frontend-only UI bugs
- third-party infrastructure incidents involving Helius or Pyth

## Circuit Breaker

RailPay’s roadmap includes an on-chain circuit breaker for anomalous outflow protection. Any new funds-out path should be reviewed for breaker coverage before merge.

## Admin Authority Model

Critical protocol configuration is controlled by an explicit on-chain admin authority stored in protocol state. Sensitive mutations must validate that signer before execution.

## Secrets Handling

The deploy keypair must never appear in source control. Deployment credentials belong in GitHub Secrets only.
