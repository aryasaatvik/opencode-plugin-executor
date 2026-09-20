// Typed failures for the Executor plugin.
//
// `ExecutorHttpError`/`ExecutorDecodeError`/`ExecutorConfigError` are this
// plugin's own channel. `ToolError` uses OpenCode's `"Tool.Error"` tag: the
// host catches failures by tag (`Effect.catchTag("Tool.Error", ...)` in
// packages/core/src/tool.ts) and re-wraps foreign failures into its own
// `Tool.Error` with the same message.

import { Schema } from "effect"

export class ExecutorHttpError extends Schema.TaggedError<ExecutorHttpError>()("Executor.HttpError", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export class ExecutorDecodeError extends Schema.TaggedError<ExecutorDecodeError>()("Executor.DecodeError", {
  message: Schema.String,
}) {}

export class ExecutorConfigError extends Schema.TaggedError<ExecutorConfigError>()("Executor.ConfigError", {
  message: Schema.String,
}) {}

export class ToolError extends Schema.TaggedError<ToolError>()("Tool.Error", {
  message: Schema.String,
}) {}
