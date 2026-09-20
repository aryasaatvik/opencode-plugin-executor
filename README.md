# opencode-plugin-executor

An OpenCode V2 [Effect plugin](https://opencode.ai) that exposes the [Executor](https://executor.arya.sh) tool catalog
natively inside OpenCode Code Mode. On setup it fetches Executor's tools and integrations and registers one namespace per
integration (`github_api`, `stripe_api`, …), so every Executor tool is callable as `tools.<integration>.<connection>.<tool>`
directly from Code Mode. Tool input schemas are loaded in the background and the registry reloads once they land.

> **Reference implementation.** This targets the author's Executor fork
> ([UsefulSoftwareCo/executor](https://github.com/UsefulSoftwareCo/executor)), not plain upstream Executor, and relies on
> that fork's HTTP API (`/api/tools`, `/api/integrations`, `/api/tools/schemas`, `/api/semantic-search/search`,
> `/api/executions`). It is open-sourced for reference, not as a distribution or a supported product. The reference
> instance is [executor.arya.sh](https://executor.arya.sh).

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

No credential is baked into the package. The CF Access service-token client id and secret are read at runtime: the
client id from `EXECUTOR_CLIENT_ID` or a file, the secret from a file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXECUTOR_BASE_URL` | `https://executor.arya.sh` | Executor instance base URL |
| `EXECUTOR_CLIENT_ID` | — | Inline CF Access client id (overrides the file) |
| `EXECUTOR_CLIENT_ID_FILE` | `~/.config/opencode/secrets/executor-cf-access-client-id` | File holding the client id |
| `EXECUTOR_CLIENT_SECRET_FILE` | `~/.config/opencode/secrets/executor-cf-access-client-secret` | File holding the client secret |
| `EXECUTOR_INCLUDE` | all | Comma-separated integration slugs to limit registration |
| `EXECUTOR_LIMIT` | all | Cap on registered tools |
| `EXECUTOR_SCHEMAS` | `on` | `off` skips schema loading |
| `EXECUTOR_CONCURRENCY` | `16` | Concurrent per-connection schema fetches |
| `EXECUTOR_SEARCH_LIMIT` | `10` | Default `executor.search` result count |
