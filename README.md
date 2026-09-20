# opencode-plugin-executor

An OpenCode V2 [Effect plugin](https://opencode.ai) that exposes the [Executor](https://executor.arya.sh) tool catalog
natively inside OpenCode Code Mode. On setup it fetches Executor's tools and integrations and registers one namespace per
integration (`github_api`, `stripe_api`, …), so every Executor tool is callable as `tools.<integration>.<connection>.<tool>`
directly from Code Mode. Tool input schemas are loaded in the background and the registry reloads once they land.

It also registers two control tools in the `executor` namespace:

- **`executor.search`** — searches Executor's semantic tool index by natural-language query
  (`{ query: string, limit?: number }`) and returns matching Code Mode paths, e.g.
  `tools["executor.search"]({ query: "list stripe customers" })` surfaces `stripe_api…customers.getCustomers`. It is
  pinned, so it stays visible under the default catalog budget.
- **`executor.refresh`** — re-fetches the tool catalog and integration metadata, reloads the Code Mode registry, and
  kicks off schema loading for any new connections.

Tool calls execute through Executor's `POST /api/executions` sandbox as a single `tools.<address>(input)` expression; the
envelope is unwrapped into the tool's `output` and rendered as text. Execution failures surface as OpenCode tool errors.

Work in progress: the plugin currently covers catalog registration, search, refresh, and execution. Deeper typing
(Jev/TypeSafe) is deferred to a later phase.

## Development

```sh
bun install
bun run typecheck
bun test
```

Register the repository path in the `plugins` array of `~/.config/opencode/opencode.jsonc` to load it.

## Configuration

Environment variables (all optional): `EXECUTOR_BASE_URL`, `EXECUTOR_CLIENT_ID`, `EXECUTOR_CLIENT_SECRET_FILE`,
`EXECUTOR_INCLUDE`, `EXECUTOR_LIMIT`, `EXECUTOR_SCHEMAS`, `EXECUTOR_CONCURRENCY`, `EXECUTOR_SEARCH_LIMIT`.
