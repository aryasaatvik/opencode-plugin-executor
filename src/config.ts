// Environment, constants, and the typed config service for the Executor plugin.
//
// Environment is read through `effect/Config` (never `process.env` directly),
// and the CF Access secret is read at the `node:fs` boundary (no platform
// FileSystem adapter is wired here) and held in a `Redacted`. `layer` exposes
// the resolved config; unreadable config or a missing secret fails with
// `ExecutorConfigError`.

import { Config, Context, Effect, Layer, Redacted } from "effect"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { ExecutorConfigError } from "./errors.ts"

export const DEFAULT_BASE_URL = "https://executor.arya.sh"
export const DEFAULT_CLIENT_ID = "60628849563c6a2911dd9d9a81027262.access"
export const DEFAULT_SECRET_FILE = join(homedir(), ".config/opencode/secrets/executor-cf-access-client-secret")

/** Rows per `/api/tools/schemas` page. */
export const SCHEMA_PAGE = 500
/** OpenCode's limit for a tool name and for each namespace segment. */
export const MAX_SEGMENT = 64
/** Hard cap for a rendered catalog line. */
export const DESCRIPTION_LIMIT = 120
/** A longer integration description is treated as unsuitable for a catalog line. */
export const DESCRIPTION_MAX = 160

export const PERMISSIVE_INPUT = { type: "object", additionalProperties: true }
export const NO_INPUT = { type: "object", additionalProperties: false }

/** Parse a comma-separated env list into a trimmed set. */
export const parseList = (value: string): ReadonlySet<string> =>
  new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )

/** Parse an optional positive integer, treating absent/empty/invalid as undefined. */
export const parseOptionalPositiveInt = (value: string): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** The environment-facing config, before the secret is read. Exported for tests. */
export const envConfig = Config.all({
  baseUrl: Config.string("EXECUTOR_BASE_URL").pipe(Config.withDefault(DEFAULT_BASE_URL)),
  clientId: Config.string("EXECUTOR_CLIENT_ID").pipe(Config.withDefault(DEFAULT_CLIENT_ID)),
  secretFile: Config.string("EXECUTOR_CLIENT_SECRET_FILE").pipe(Config.withDefault(DEFAULT_SECRET_FILE)),
  include: Config.string("EXECUTOR_INCLUDE").pipe(Config.withDefault(""), Config.map(parseList)),
  limit: Config.string("EXECUTOR_LIMIT").pipe(Config.withDefault(""), Config.map(parseOptionalPositiveInt)),
  schemas: Config.string("EXECUTOR_SCHEMAS").pipe(Config.withDefault("on")),
  concurrency: Config.string("EXECUTOR_CONCURRENCY").pipe(Config.withDefault(""), Config.map(parseOptionalPositiveInt)),
  searchLimit: Config.string("EXECUTOR_SEARCH_LIMIT").pipe(
    Config.withDefault(""),
    Config.map(parseOptionalPositiveInt),
  ),
})

export interface Interface {
  readonly baseUrl: string
  readonly clientId: string
  readonly secret: Redacted.Redacted
  readonly include: ReadonlySet<string>
  readonly limit: number | undefined
  readonly loadSchemas: boolean
  readonly concurrency: number
  readonly searchLimit: number
}

export class Service extends Context.Service<Service, Interface>()("@opencode-executor/ExecutorConfig") {}

/** Read the CF Access secret, trimming trailing newlines. */
export const readSecret = (path: string): Effect.Effect<string, ExecutorConfigError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (error) =>
      new ExecutorConfigError({ message: `could not read Executor secret at ${path}: ${String(error)}` }),
  }).pipe(Effect.map((value) => value.trim()))

export const layer: Layer.Layer<Service, ExecutorConfigError> = Layer.effect(
  Service,
)(
  Effect.gen(function* () {
    const env = yield* envConfig.pipe(
      Effect.mapError((error) => new ExecutorConfigError({ message: error.message })),
    )
    const secret = yield* readSecret(env.secretFile)
    return Service.of({
      baseUrl: env.baseUrl.replace(/\/+$/, ""),
      clientId: env.clientId,
      secret: Redacted.make(secret),
      include: env.include,
      limit: env.limit,
      loadSchemas: env.schemas !== "off",
      concurrency: env.concurrency ?? 16,
      searchLimit: env.searchLimit ?? 10,
    })
  }),
)

export * as ExecutorConfig from "./config"
