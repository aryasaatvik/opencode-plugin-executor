// Wire models for every Executor HTTP payload.
//
// These are the single source of truth for the shapes crossing the network
// boundary; the decoded TypeScript types are derived from the schemas (never
// hand-declared), and `client.ts` decodes every response through them.

import { Schema } from "effect"

/** One row from `GET /api/tools`. */
export const ToolRow = Schema.Struct({
  address: Schema.String,
  owner: Schema.String,
  integration: Schema.String,
  connection: Schema.String,
  name: Schema.String,
  pluginId: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
})
export interface ToolRow extends Schema.Schema.Type<typeof ToolRow> {}

/** The catalog projection of an integration from `GET /api/integrations`. */
export const IntegrationSummary = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kind: Schema.optional(Schema.String),
})
export interface IntegrationSummary extends Schema.Schema.Type<typeof IntegrationSummary> {}

/** One entry from `GET /api/tools/schemas`. */
export const SchemaEntry = Schema.Struct({
  address: Schema.String,
  inputSchema: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  definitions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export interface SchemaEntry extends Schema.Schema.Type<typeof SchemaEntry> {}

/** One item from `GET /api/semantic-search/search`. */
export const SemanticSearchItem = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  integration: Schema.String,
  score: Schema.Number,
})
export interface SemanticSearchItem extends Schema.Schema.Type<typeof SemanticSearchItem> {}

/** The `GET /api/semantic-search/search` envelope. */
export const SearchResponse = Schema.Struct({
  items: Schema.optional(Schema.Array(SemanticSearchItem)),
})
export interface SearchResponse extends Schema.Schema.Type<typeof SearchResponse> {}

/** The `POST /api/executions` envelope (completed or paused). */
export const ExecuteResponse = Schema.Struct({
  status: Schema.Literals(["completed", "paused"]),
  text: Schema.optional(Schema.String),
  structured: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
})
export interface ExecuteResponse extends Schema.Schema.Type<typeof ExecuteResponse> {}
