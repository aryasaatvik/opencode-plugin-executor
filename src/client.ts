// Typed Executor HTTP client.
//
// Every call goes through `effect/unstable/http`. The layer composes the base
// URL, auth headers, status classification, and transient retry once, then the
// service methods build requests and decode with the schemas from ./schemas.ts.
// GET calls use the retrying client; the executions POST uses the plain base
// client (it may pause for approval or mutate state and must not be retried).

import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"

import { ExecutorConfig } from "./config.ts"
import { ExecutorDecodeError, ExecutorHttpError } from "./errors.ts"
import {
  ExecuteResponse,
  IntegrationSummary,
  SchemaEntry,
  SearchResponse,
  SemanticSearchItem,
  ToolRow,
} from "./schemas.ts"
import type { ConnectionScope } from "./types.ts"

const GET_TIMEOUT = Duration.seconds(30)
const POST_TIMEOUT = Duration.seconds(120)

export interface ConnectionSchemaPage {
  readonly after?: string
  readonly page: number
}

export interface Interface {
  readonly tools: () => Effect.Effect<ReadonlyArray<ToolRow>, ExecutorHttpError | ExecutorDecodeError>
  readonly integrations: () => Effect.Effect<ReadonlyArray<IntegrationSummary>, ExecutorHttpError | ExecutorDecodeError>
  readonly connectionSchemas: (
    scope: ConnectionScope,
    page: ConnectionSchemaPage,
  ) => Effect.Effect<ReadonlyArray<SchemaEntry>, ExecutorHttpError | ExecutorDecodeError>
  readonly semanticSearch: (input: {
    readonly query: string
    readonly limit: number
  }) => Effect.Effect<ReadonlyArray<SemanticSearchItem>, ExecutorHttpError | ExecutorDecodeError>
  readonly execute: (code: string) => Effect.Effect<ExecuteResponse, ExecutorHttpError | ExecutorDecodeError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-executor/ExecutorClient") {}

/** The minimal execute surface shared by the base and retrying clients. */
interface Executing {
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>
}

const toHttpError = (error: HttpClientError.HttpClientError): ExecutorHttpError =>
  new ExecutorHttpError({ message: error.message, status: error.response?.status })

const decode = <A>(schema: Schema.Codec<A, unknown>, value: unknown): Effect.Effect<A, ExecutorDecodeError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) => new ExecutorDecodeError({ message: error.message })),
  )

const make: Effect.Effect<Interface, never, HttpClient.HttpClient | ExecutorConfig.Service> = Effect.gen(
  function* () {
    const http = yield* HttpClient.HttpClient
    const config = yield* ExecutorConfig.Service
    const headers: Record<string, string> = {
      "CF-Access-Client-Id": config.clientId,
      "CF-Access-Client-Secret": Redacted.value(config.secret),
      accept: "application/json",
    }

    const base = http.pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(config.baseUrl)),
      HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)),
      HttpClient.filterStatusOk,
    )
    const retrying = base.pipe(HttpClient.retryTransient({ times: 3 }))

    const requestJson = <A>(
      client: Executing,
      schema: Schema.Codec<A, unknown>,
      request: HttpClientRequest.HttpClientRequest,
      timeout: Duration.Input,
    ): Effect.Effect<A, ExecutorHttpError | ExecutorDecodeError> =>
      Effect.gen(function* () {
        const response = yield* client.execute(request).pipe(
          Effect.mapError(toHttpError),
          Effect.timeoutOption(timeout),
          Effect.flatMap((maybe) =>
            Option.match(maybe, {
              onNone: () => Effect.fail(new ExecutorHttpError({ message: "Executor request timed out" })),
              onSome: (value) => Effect.succeed(value),
            }),
          ),
        )
        const json = yield* response.json.pipe(Effect.mapError(toHttpError))
        return yield* decode(schema, json)
      })

    const tools = Effect.fn("ExecutorClient.tools")(function* () {
      return yield* requestJson(retrying, Schema.Array(ToolRow), HttpClientRequest.get("/api/tools"), GET_TIMEOUT)
    })

    const integrations = Effect.fn("ExecutorClient.integrations")(function* () {
      return yield* requestJson(
        retrying,
        Schema.Array(IntegrationSummary),
        HttpClientRequest.get("/api/integrations"),
        GET_TIMEOUT,
      )
    })

    const connectionSchemas = Effect.fn("ExecutorClient.connectionSchemas")(
      function* (scope: ConnectionScope, page: ConnectionSchemaPage) {
        const params: Record<string, string> = {
          integration: scope.integration,
          owner: scope.owner,
          connection: scope.connection,
          limit: String(page.page),
        }
        if (page.after !== undefined) params.after = page.after
        return yield* requestJson(
          retrying,
          Schema.Array(SchemaEntry),
          HttpClientRequest.get("/api/tools/schemas", { urlParams: params }),
          GET_TIMEOUT,
        )
      },
    )

    const semanticSearch = Effect.fn("ExecutorClient.semanticSearch")(
      function* (input: { readonly query: string; readonly limit: number }) {
        return yield* requestJson(
          retrying,
          SearchResponse,
          HttpClientRequest.get("/api/semantic-search/search", {
            urlParams: { q: input.query, limit: String(input.limit) },
          }),
          GET_TIMEOUT,
        ).pipe(Effect.map((response) => response.items ?? []))
      },
    )

    const execute = Effect.fn("ExecutorClient.execute")(function* (code: string) {
      const request = yield* HttpClientRequest.post("/api/executions").pipe(
        HttpClientRequest.bodyJson({ code }),
        Effect.mapError((error) => new ExecutorHttpError({ message: error.message })),
      )
      return yield* requestJson(base, ExecuteResponse, request, POST_TIMEOUT)
    })

    return Service.of({ tools, integrations, connectionSchemas, semanticSearch, execute })
  },
)

export const layer: Layer.Layer<Service, never, ExecutorConfig.Service> = Layer.effect(Service)(make).pipe(
  Layer.provide(FetchHttpClient.layer),
)

export * as ExecutorClient from "./client"
