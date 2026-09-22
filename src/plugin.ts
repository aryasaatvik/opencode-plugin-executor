// OpenCode V2 Effect plugin (@opencode-executor): Executor's tool catalog as native Code Mode tools.
//
// Setup resolves the config + HTTP client from their layers, loads the catalog,
// and registers one namespace per integration plus two control tools. The
// transform callback OpenCode stores is synchronous and replayed on every
// registry rebuild, so it only replays a precomputed plan from a `Ref` (read
// with `Ref.getUnsafe`). All I/O happens in `execute` effects or in forked
// schema-loading fibers; tool `execute` effects are `R = never` because the
// client and config are captured at setup.

import { Effect, Option, Ref } from "effect"

import { ExecutorClient } from "./client.ts"
import { ExecutorConfig, NO_INPUT, PERMISSIVE_INPUT, SCHEMA_PAGE } from "./config.ts"
import { ToolError } from "./errors.ts"
import {
  addressPath,
  connectionsOf,
  filterSearchResults,
  integrationLine,
  normalize,
  registrationName,
  render,
  scopeKey,
  selfContained,
} from "./catalog.ts"
import type {
  ExecuteResponse,
  IntegrationSummary,
  SchemaEntry,
  SemanticSearchItem,
  ToolRow,
} from "./schemas.ts"
import type { ConnectionScope, PluginContext, ToolEditor } from "./types.ts"

const CONTROL_NAMESPACE = "executor"
const CONTROL_DESCRIPTION = "Search and refresh the Executor tool catalog."

const SEARCH_INPUT = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Natural-language description of the Executor tool to find.",
    },
    limit: {
      type: "number",
      description: "Maximum number of matches to return (default 10).",
    },
  },
  required: ["query"],
  additionalProperties: false,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Unwrap the executions envelope down to the tool's own return value. */
const unwrapExecution = (body: ExecuteResponse): unknown => {
  const structured = isRecord(body.structured) ? body.structured : undefined
  if (structured && "result" in structured) return structured.result
  return structured ?? body.text
}

interface PlannedTool {
  readonly namespace: string
  readonly name: string
  readonly description: string
  readonly input: unknown
  readonly row: ToolRow
}

interface CatalogPlan {
  readonly namespaces: ReadonlyArray<{ readonly name: string; readonly description: string }>
  readonly tools: ReadonlyArray<PlannedTool>
  readonly registered: ReadonlySet<string>
}

interface CatalogState {
  readonly generation: number
  readonly rows: ReadonlyArray<ToolRow>
  readonly integrations: ReadonlyMap<string, IntegrationSummary>
  readonly schemas: ReadonlyMap<string, Record<string, unknown>>
  readonly loaded: ReadonlySet<string>
  readonly plan: CatalogPlan
}

const topLevel = (row: ToolRow): string => {
  const namespace = registrationName(row).namespace
  return namespace.split(".")[0] ?? namespace
}

const integrationCount = (rows: ReadonlyArray<ToolRow>): number => new Set(rows.map(topLevel)).size

/**
 * Build the replayable registration plan from the current rows, integrations,
 * and schemas. Mirrors OpenCode's own namespace/name normalization: the
 * effective id is `namespace.replaceAll(".", "_") + "_" + name`, so a collision
 * appends `_2`, `_3`, … The control tools' ids are reserved up front.
 */
const buildPlan = (
  rows: ReadonlyArray<ToolRow>,
  integrations: ReadonlyMap<string, IntegrationSummary>,
  schemas: ReadonlyMap<string, Record<string, unknown>>,
): CatalogPlan => {
  const groups = new Map<string, ToolRow[]>()
  for (const row of rows) {
    const group = topLevel(row)
    const list = groups.get(group)
    if (list) list.push(row)
    else groups.set(group, [row])
  }

  const used = new Set<string>([`${CONTROL_NAMESPACE}_search`, `${CONTROL_NAMESPACE}_refresh`])
  const registered = new Set<string>()
  const tools: PlannedTool[] = []
  const namespaces: { name: string; description: string }[] = []

  for (const [group, groupRows] of groups) {
    namespaces.push({ name: group, description: integrationLine(integrations.get(group), groupRows.length) })
    for (const row of groupRows) {
      const { namespace, leaf } = registrationName(row)
      let name = leaf
      let counter = 1
      let effective = `${namespace.replaceAll(".", "_")}_${name}`
      while (used.has(effective)) {
        counter += 1
        name = `${leaf}_${counter}`
        effective = `${namespace.replaceAll(".", "_")}_${name}`
      }
      used.add(effective)
      registered.add(`${namespace}.${name}`)
      tools.push({
        namespace,
        name,
        description: row.description ?? row.address,
        input: schemas.get(row.address) ?? PERMISSIVE_INPUT,
        row,
      })
    }
  }

  return { namespaces, tools, registered }
}

const plugin = {
  id: "executor",
  effect: (context: PluginContext) =>
    Effect.gen(function* () {
      const config = yield* ExecutorConfig.Service
      const client = yield* ExecutorClient.Service

      const state = Ref.makeUnsafe<CatalogState>({
        generation: 0,
        rows: [],
        integrations: new Map(),
        schemas: new Map(),
        loaded: new Set(),
        plan: { namespaces: [], tools: [], registered: new Set() },
      })

      const applyFilters = (rows: ReadonlyArray<ToolRow>): ReadonlyArray<ToolRow> => {
        const included = config.include.size > 0 ? rows.filter((row) => config.include.has(row.integration)) : rows
        return config.limit === undefined ? included : included.slice(0, config.limit)
      }

      const pruneSchemas = (
        schemas: ReadonlyMap<string, Record<string, unknown>>,
        rows: ReadonlyArray<ToolRow>,
      ): Map<string, Record<string, unknown>> => {
        const addresses = new Set(rows.map((row) => row.address))
        const next = new Map<string, Record<string, unknown>>()
        for (const [address, schema] of schemas) if (addresses.has(address)) next.set(address, schema)
        return next
      }

      /** Re-fetch tools + integrations and swap the whole snapshot. */
      const loadCatalog = Effect.gen(function* () {
        const [rows, integrationList] = yield* Effect.all([client.tools(), client.integrations()], {
          concurrency: 2,
        })
        const integrations = new Map(integrationList.map((integration) => [normalize(integration.slug), integration]))
        const filtered = applyFilters(rows)
        const current = yield* Ref.get(state)
        const schemas = pruneSchemas(current.schemas, filtered)
        yield* Ref.set(state, {
          generation: current.generation + 1,
          rows: filtered,
          integrations,
          schemas,
          loaded: current.loaded,
          plan: buildPlan(filtered, integrations, schemas),
        })
      }).pipe(
        Effect.catchTag("Executor.HttpError", (error) =>
          Effect.logError(`[executor] catalog fetch failed: ${error.message}`).pipe(
            Effect.annotateLogs({ status: error.status ?? "unknown" }),
          ),
        ),
        Effect.catchTag("Executor.DecodeError", (error) =>
          Effect.logError(`[executor] catalog decode failed: ${error.message}`),
        ),
      )

      const annotateScope = (scope: ConnectionScope) => ({
        integration: scope.integration,
        connection: scope.connection,
      })

      const fetchConnectionSchemas = (scope: ConnectionScope) =>
        Effect.gen(function* () {
          const collected = new Map<string, Record<string, unknown>>()
          let complete = true
          let after: string | undefined
          while (true) {
            const maybeEntries = yield* client.connectionSchemas(scope, { after, page: SCHEMA_PAGE }).pipe(
              Effect.map((entries) => Option.some(entries)),
              Effect.catchTag("Executor.HttpError", (error) =>
                Effect.logError(`[executor] schema fetch failed: ${error.message}`).pipe(
                  Effect.annotateLogs(annotateScope(scope)),
                  Effect.as(Option.none<ReadonlyArray<SchemaEntry>>()),
                ),
              ),
              Effect.catchTag("Executor.DecodeError", (error) =>
                Effect.logError(`[executor] schema decode failed: ${error.message}`).pipe(
                  Effect.annotateLogs(annotateScope(scope)),
                  Effect.as(Option.none<ReadonlyArray<SchemaEntry>>()),
                ),
              ),
            )
            if (Option.isNone(maybeEntries)) {
              complete = false
              break
            }
            const entries = maybeEntries.value
            for (const entry of entries) {
              const input = selfContained(entry)
              if (input) collected.set(entry.address, input)
            }
            if (entries.length < SCHEMA_PAGE) break
            const last = entries[entries.length - 1]
            if (last === undefined) break
            after = last.address
          }
          return { complete, schemas: collected }
        })

      /** Load selected schemas not yet fetched, merge them into the latest catalog, then reload. */
      const loadSchemas = (selected?: ReadonlyArray<ConnectionScope>) => Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const missing = new Set(
          current.rows.filter((row) => !current.schemas.has(row.address)).map(scopeKey),
        )
        const pending = (selected ?? connectionsOf(current.rows)).filter(
          (scope) => !current.loaded.has(scopeKey(scope)) || missing.has(scopeKey(scope)),
        )
        if (pending.length === 0) return false

        const perConnection = yield* Effect.forEach(pending, fetchConnectionSchemas, {
          concurrency: config.concurrency,
        })
        yield* Ref.update(state, (latest) => {
          const addresses = new Set(latest.rows.map((row) => row.address))
          const schemas = new Map(latest.schemas)
          for (const result of perConnection) {
            for (const [address, schema] of result.schemas) if (addresses.has(address)) schemas.set(address, schema)
          }
          const loaded = new Set(latest.loaded)
          for (const [index, scope] of pending.entries()) {
            if (perConnection[index]?.complete) loaded.add(scopeKey(scope))
          }
          return {
            ...latest,
            schemas,
            loaded,
            plan: buildPlan(latest.rows, latest.integrations, schemas),
          }
        })

        yield* context.tool.reload()
        return true
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError(`[executor] schema load failed: ${cause}`).pipe(Effect.as(false)),
        ),
      )

      const makeExecute =
        (row: ToolRow) =>
        (input: unknown): Effect.Effect<{ content: string; output: unknown }, ToolError> =>
          Effect.gen(function* () {
            const code = `return await tools.${addressPath(row)}(${JSON.stringify(input ?? {})})`
            const body = yield* client.execute(code).pipe(
              Effect.catchTag("Executor.HttpError", (error) =>
                Effect.fail(new ToolError({ message: `Executor request failed: ${error.message}` })),
              ),
              Effect.catchTag("Executor.DecodeError", (error) =>
                Effect.fail(new ToolError({ message: `Executor returned invalid JSON: ${error.message}` })),
              ),
            )
            if (body.status === "paused") {
              return { content: body.text ?? "Execution paused for approval.", output: body.structured ?? null }
            }
            if (body.isError) {
              yield* Effect.fail(new ToolError({ message: body.text || render(body.structured) || "Executor call failed." }))
            }
            const value = unwrapExecution(body)
            const union = isRecord(value) ? value : undefined
            if (union?.ok === false) {
              yield* Effect.fail(new ToolError({ message: render(union.error ?? union) }))
            }
            const data = union?.ok === true && "data" in union ? union.data : value
            return { content: render(data), output: data ?? null }
          })

      const searchExecute = (input: unknown): Effect.Effect<{ content: string; output: unknown }, never> =>
        Effect.gen(function* () {
          const record = isRecord(input) ? input : {}
          const query = typeof record.query === "string" ? record.query : ""
          const limit = typeof record.limit === "number" ? record.limit : config.searchLimit
          const maybeItems = yield* client.semanticSearch({ query, limit }).pipe(
            Effect.map((items) => Option.some(items)),
            Effect.catchTag("Executor.HttpError", (error) =>
              Effect.logError(`[executor] search failed: ${error.message}`).pipe(
                Effect.as(Option.none<ReadonlyArray<SemanticSearchItem>>()),
              ),
            ),
            Effect.catchTag("Executor.DecodeError", (error) =>
              Effect.logError(`[executor] search decode failed: ${error.message}`).pipe(
                Effect.as(Option.none<ReadonlyArray<SemanticSearchItem>>()),
              ),
            ),
          )
          if (Option.isNone(maybeItems)) {
            return {
              content: "Executor search is unavailable right now; the catalog is still registered.",
              output: { items: [] },
            }
          }
          const before = yield* Ref.get(state)
          let items = filterSearchResults(maybeItems.value, before.plan.registered)
          if (config.loadSchemas && items.length > 0) {
            const matched = new Set(items.map((item) => item.path))
            const scopes = connectionsOf(
              before.plan.tools
                .filter((tool) => matched.has(`${tool.namespace}.${tool.name}`))
                .map((tool) => tool.row),
            )
            const reloaded = yield* loadSchemas(scopes)
            if (!reloaded) yield* context.tool.reload()
            // `reload` replays the transform synchronously. Only return paths whose
            // exact schema is now present in the registry the next model step sees.
            const ready = yield* Ref.get(state)
            const addresses = new Map(
              ready.plan.tools.map((tool) => [`${tool.namespace}.${tool.name}`, tool.row.address]),
            )
            items = items.filter((item) => {
              const address = addresses.get(item.path)
              return address !== undefined && ready.schemas.has(address)
            })
          }
          const content =
            items.length > 0
              ? items.map((item) => `tools.${item.path}`).join("\n")
              : "No matching Executor tools."
          return { content, output: { items } }
        })

      const refreshExecute = (): Effect.Effect<{ content: string; output: unknown }, never> =>
        Effect.gen(function* () {
          yield* loadCatalog
          yield* context.tool.reload()
          if (config.loadSchemas) {
            yield* Effect.forkDetach(loadSchemas())
          }
          const current = yield* Ref.get(state)
          const count = integrationCount(current.rows)
          return {
            content: `Refreshed ${current.rows.length} tools across ${count} integrations.`,
            output: { tools: current.rows.length, integrations: count },
          }
        })

      const register = (editor: ToolEditor) => {
        const plan = Ref.getUnsafe(state).plan
        editor.namespace({ name: CONTROL_NAMESPACE, description: CONTROL_DESCRIPTION })
        editor.add({
          name: "search",
          description:
            "Search Executor's tool catalog by natural-language query and return matching Code Mode tool paths.",
          input: SEARCH_INPUT,
          output: {},
          options: { namespace: CONTROL_NAMESPACE, codemode: true, pinned: true },
          execute: searchExecute,
        })
        editor.add({
          name: "refresh",
          description:
            "Re-fetch the Executor tool catalog and integration metadata, then reload the Code Mode registry.",
          input: NO_INPUT,
          output: {},
          options: { namespace: CONTROL_NAMESPACE, codemode: true },
          execute: refreshExecute,
        })
        for (const namespace of plan.namespaces) editor.namespace(namespace)
        for (const tool of plan.tools) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.input,
            output: {},
            options: { namespace: tool.namespace, codemode: true },
            execute: makeExecute(tool.row),
          })
        }
      }

      yield* loadCatalog
      yield* context.tool.transform(register)

      if (config.loadSchemas) {
        yield* Effect.forkScoped(loadSchemas())
      }
    }).pipe(
      Effect.provide(ExecutorClient.layer),
      Effect.provide(ExecutorConfig.layer),
    ),
}

export default plugin
