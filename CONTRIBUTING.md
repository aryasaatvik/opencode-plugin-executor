# Contributing

Use Bun 1.4.3, pinned in `package.json` under `packageManager`.

```sh
bun install --frozen-lockfile
bun run check
```

`check` runs Oxfmt formatting checks, Oxlint, root TypeScript checks, and the normal
offline Bun tests. `typecheck` includes source, tests, `scripts/`, `tools/`, and root
`*.config.ts` files. Use `bun run format` to apply formatting; the individual
`format:check`, `lint`, `typecheck`, and `test` commands are available separately.
CI reads the same Bun pin and runs a frozen install followed by `check` on pull
requests and pushes to `main`.

Tests use temporary files, synthetic credentials, and a local HTTP server. They do
not need live Executor access or real OpenCode secrets. Keep new fixtures isolated
from user configuration and do not change `HOME` to run them.

## Source loading and releases

This is a reference implementation for the author's Executor fork, not a supported
distribution. OpenCode loads the repository's TypeScript source through the
`./index.ts` export; register the repository path in the host's plugin configuration.
Keep the source export and Effect `4.0.0-rc.112` pin compatible with that host.

`build` and `test:artifact` do not apply: there is no compiled or packed distributable.
`release:version` and `release:publish` do not apply either. There is no release,
publishing, or deployment workflow; merging a contribution only runs CI.
