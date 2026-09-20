// Catalog shaping: turn Executor's tool + integration metadata into OpenCode
// Code Mode registrations. Pure functions only — all I/O lives in ./client.ts.
//
// Executor names are already hierarchical (`gmail.users.drafts.create`), but
// OpenCode flattens every non-alphanumeric in a tool name to `_`, erasing the
// dots and burying the verb. Code Mode's search scores a query term `+20` only
// when it equals the *final* path segment, so we preserve Executor's own dots:
// the name prefix becomes namespace segments and only the last segment is the
// tool name. Because OpenCode already collapsed dots to `_` when computing the
// effective id, re-splitting them into a namespace is a bijection over the
// previous id space — it cannot introduce a collision — and it moves characters
// out of the length-checked name field into separately-checked namespace
// segments, recovering tools the 64-char name cap used to drop.

import { DESCRIPTION_LIMIT, DESCRIPTION_MAX, MAX_SEGMENT } from "./config.ts"
import type { IntegrationSummary, SchemaEntry, SemanticSearchItem, ToolRow } from "./schemas.ts"
import type { ConnectionScope, RegistrationName } from "./types.ts"

/** A structural guard; avoids casts when probing `unknown` payloads. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** OpenCode normalizes tool/namespace names it registers; mirror it. */
export const normalize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export const titleCase = (value: string) =>
  value
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")

/** `tools.<integration>.<owner>.<connection>.<tool>` -> the sandbox path. */
export const addressPath = (tool: ToolRow) => tool.address.replace(/^tools\./, "")

export const scopeKey = (scope: ConnectionScope) => `${scope.integration}\u0000${scope.owner}\u0000${scope.connection}`

export const connectionsOf = (rows: readonly ToolRow[]): ConnectionScope[] => [
  ...new Map(
    rows.map((tool) => [
      scopeKey(tool),
      { integration: tool.integration, owner: tool.owner, connection: tool.connection },
    ]),
  ).values(),
]

/**
 * Derive the OpenCode namespace + leaf for an Executor tool.
 *
 * `owner` is dropped: it is `org` for all but the thirty `user`-owned Executor
 * core tools, and the connection is the meaningful discriminator. A leading
 * name segment that repeats the connection is dropped too, so the Executor core
 * tools read `executor.coreTools.integrations.list`.
 */
export function registrationName(tool: ToolRow): RegistrationName {
  const integration = normalize(tool.integration)
  const connection = normalize(tool.connection)

  let parts = tool.name
    .split(".")
    .map((part) => normalize(part))
    .filter((part) => part.length > 0)
  const first = parts[0]
  if (parts.length > 1 && first !== undefined && first.toLowerCase() === connection.toLowerCase()) parts = parts.slice(1)
  if (parts.length === 0) parts = [normalize(tool.name)]

  const segments = [integration, connection, ...parts.slice(0, -1)]
  let leaf = parts[parts.length - 1] ?? normalize(tool.name)

  // Names past the cap: relocate a camel-boundary prefix into the namespace
  // until the leaf is registrable. OpenCode checks the name and each namespace
  // segment against 64 characters independently, so splitting across them keeps
  // the tool alive.
  while (leaf.length > MAX_SEGMENT) {
    let split = MAX_SEGMENT
    for (let index = Math.min(MAX_SEGMENT, leaf.length - 1); index > 0; index -= 1) {
      const previous = leaf[index - 1]
      const current = leaf[index]
      if (previous === undefined || current === undefined) continue
      if (current !== "_" && (previous === "_" || (current >= "A" && current <= "Z"))) {
        split = index
        break
      }
    }
    const head = leaf.slice(0, split).replace(/_+$/, "")
    if (head.length > 0) segments.push(head)
    leaf = leaf.slice(split).replace(/^_+/, "")
  }
  if (leaf.length > MAX_SEGMENT) leaf = leaf.slice(0, MAX_SEGMENT)
  if (leaf.length === 0) leaf = "tool"

  return { namespace: segments.join("."), leaf }
}

/**
 * The catalog line for an integration namespace.
 *
 * Prefer the Executor display name, and append the description only when it is
 * short, non-empty, and actually differs from the name — the integrations API
 * carries full OpenAPI `info.description` blobs and MCP operational notes that
 * would otherwise wreck the catalog line.
 */
export function integrationLine(integration: IntegrationSummary | undefined, count: number): string {
  if (!integration) return `${count} Executor tools`
  const name = integration.name || integration.slug
  const description = (integration.description ?? "").replace(/\s+/g, " ").trim()
  const usable =
    description.length > 0 && description.length <= DESCRIPTION_MAX && description.toLowerCase() !== name.toLowerCase()
  const line = usable ? `${name} — ${description}` : name
  return line.length > DESCRIPTION_LIMIT ? `${line.slice(0, DESCRIPTION_LIMIT - 3)}...` : line
}

/**
 * Map an Executor address (`integration.owner.connection.name`) to the code-mode
 * path OpenCode registers (`integration.connection.name`). Returns undefined when
 * the address has too few segments to be an Executor tool path.
 */
export function codeModePath(address: string): string | undefined {
  const parts = address.split(".")
  if (parts.length < 3) return undefined
  return [parts[0], ...parts.slice(2)].join(".")
}

/** One search hit after mapping to a Code Mode path and filtering to registered tools. */
export interface RegisteredSearchItem {
  readonly path: string
  readonly description?: string
  readonly score: number
}

/**
 * Filter raw `tools.search` hits down to paths OpenCode actually registers.
 *
 * `registered` holds the Code Mode paths produced by `registrationName`; every
 * result `path` is first mapped through `codeModePath` (owner segment dropped),
 * then dropped unless it is present. The output keeps the fused score.
 */
export function filterSearchResults(
  items: readonly SemanticSearchItem[],
  registered: ReadonlySet<string>,
): RegisteredSearchItem[] {
  const results: RegisteredSearchItem[] = []
  for (const item of items) {
    const path = codeModePath(item.path)
    if (!path || !registered.has(path)) continue
    results.push({ path, description: item.description, score: item.score })
  }
  return results
}

/** Fold a schema entry's referenced definitions into `$defs` so `$ref`s resolve. */
export function selfContained(entry: SchemaEntry): Record<string, unknown> | undefined {
  const input = entry.inputSchema
  if (!input) return undefined
  if (!entry.definitions || Object.keys(entry.definitions).length === 0) return input
  const existing = isRecord(input.$defs) ? input.$defs : {}
  return { ...input, $defs: { ...existing, ...entry.definitions } }
}

/** Render a tool value as text content for the model. */
export function render(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
