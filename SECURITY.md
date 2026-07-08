# Security policy

## Reporting a vulnerability

Email **nikhil.prakash@solana.org** with details. Please include:

- What the issue is and how to reproduce it
- What an attacker can do with it
- Any suggested fix

Do not open a public GitHub issue for security problems. We'll acknowledge within 5 business days.

## Scope

The project revolves around an end-to-end encrypted vault (see `README.md` for the full threat model). Reports we're especially interested in:

- Any way the server could learn plaintext of a user's portfolios or snapshots
- Any way one user could read another user's vault
- Weakness in the wallet-signature → AES key derivation
- IV reuse, decrypt oracles, or version-race issues in the vault protocol
- Cross-origin / XSS / CSRF that could exfiltrate the session AES key
- Dependency vulnerabilities that reach either the vault code path or user data

Out of scope, but appreciated:

- Bugs in third-party price/data providers (Helius, Birdeye, Lambda, Dialect) — please report to them
- Rate limits or DoS of the free hosted instance
- Reports based solely on the fact that the operator can serve modified JavaScript to your browser (this is the acknowledged trust boundary for any web app; use the source you audit or self-host)

## Auditing the vault claims

The two files that touch the vault are `server/vault.ts` (~40 lines) and `server/routes/vault.ts` (~50 lines). Neither imports a crypto library. Verify:

```bash
grep -rEn 'crypto\.subtle|createDecipher|decrypt' server/
# expected: only README-style doc comments + server/utils/jwt.ts (HMAC, unrelated)

grep -A 10 'CREATE TABLE' server/vault.ts
# expected: only owner_wallet, ciphertext, iv, version, updated_at
```

Client-side derivation lives in `client/src/lib/vault.ts`.
