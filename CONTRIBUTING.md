# Contributing

Thanks for considering a contribution. Small, focused PRs are always welcome.

## Dev setup

Requires Node 22+.

```bash
make install                  # server + client deps
cp .env.example .env          # fill BIRDEYE / HELIUS / LAMBDA_P2P / DIALECT / METRICS_SECRET
npm run dev                   # server on :3000
cd client && npm run dev      # Vite on :5173, proxies /api → :3000
```

Get the API keys from:

- Birdeye: <https://bds.birdeye.so/>
- Helius: <https://helius.dev/>
- Lambda P2P: their DeFi positions provider
- Dialect: <https://dial.to>
- `METRICS_SECRET` — generate any 32-byte random string

## Before you push

```bash
npm run typecheck                     # server
cd client && npm run typecheck        # client
cd client && npm run build            # catches build-only errors
```

Both typechecks must be clean. There is no test suite yet — if you add one, keep it simple and colocated with the code it tests.

## PR guidelines

- One logical change per PR. If your commit message needs "and" more than once, split it.
- Follow existing conventions: strict TypeScript, `.js` import extensions on the server, Tailwind v4 tokens on the client.
- Explain *why* in the PR description; the diff already shows *what*.
- No new dependencies without a good reason. See `CLAUDE.md` for the stdlib-first ladder.

## Areas that specifically welcome help

- Additional DeFi protocol integrations (see `server/utils/lambda-p2p.ts` and `server/utils/dialect.ts` for the patterns)
- More wallet adapters via the Jupiter Unified Wallet Kit config
- Test coverage — currently zero
- Accessibility fixes (keyboard nav, aria-*)
- i18n

## Security

Do not open public issues for security bugs. See [SECURITY.md](./SECURITY.md).
