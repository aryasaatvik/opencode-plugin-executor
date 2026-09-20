// Non-wire types: OpenCode's V2 Effect plugin API and a few domain helpers.
//
// Wire payload types live in ./schemas.ts. We intentionally do not import
// `@opencode/plugin`: the host pins `effect@4.0.0-rc.112`, bare specifiers
// resolve from this package's node_modules, `Plugin.define` is identity, and
// the published plugin package is a stale V1 API. These local types mirror the
// host shapes so the plugin type-checks without that dependency.

import type { Effect, Scope } from "effect"

/** The connection a set of Executor tools belongs to. */
export interface ConnectionScope {
  readonly integration: string
  readonly owner: string
  readonly connection: string
}

/** The OpenCode namespace + leaf an Executor tool registers under. */
export interface RegistrationName {
  readonly namespace: string
  readonly leaf: string
}

export interface ToolNamespace {
  readonly name: string
  readonly description: string
}

export interface OpenCodeTool {
  readonly name: string
  readonly description: string
  readonly input: unknown
  readonly output?: unknown
  readonly options?: { readonly namespace?: string; readonly codemode?: boolean; readonly pinned?: boolean }
  readonly execute: (input: unknown, context: unknown) => Effect.Effect<{ output?: unknown; content?: string }, unknown>
}

export interface ToolEditor {
  namespace(namespace: ToolNamespace): void
  add(tool: OpenCodeTool): void
  update(id: string, update: (tool: OpenCodeTool) => void): void
  remove(id: string): void
  list(): readonly unknown[]
  get(id: string): unknown
}

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface PluginContext {
  readonly tool: {
    readonly transform: (
      callback: (editor: ToolEditor) => void,
    ) => Effect.Effect<Registration, never, Scope.Scope>
    readonly reload: () => Effect.Effect<void>
  }
}
