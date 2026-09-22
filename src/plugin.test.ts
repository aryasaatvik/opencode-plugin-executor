import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import plugin from "./plugin.ts"
import type { OpenCodeTool, PluginContext, ToolEditor } from "./types.ts"

const savedEnv = { ...process.env }

afterEach(() => {
  process.env = { ...savedEnv }
})

describe("executor.search schema readiness", () => {
  test("hydrates matched and refresh-added tools before returning their paths", async () => {
    let schemaRequests = 0
    let startFirstSchemaRequest!: () => void
    const firstSchemaRequest = new Promise<void>((resolve) => {
      startFirstSchemaRequest = resolve
    })
    const stalledSchemaResponse = new Promise<Response>(() => {})
    const address = "tools.google_search_console.org.primary.searchAnalytics.query"
    const addedAddress = "tools.google_search_console.org.primary.sites.get"
    const inputSchema = {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
      additionalProperties: false,
    }
    const addedInputSchema = {
      type: "object",
      properties: { siteUrl: { type: "string" } },
      required: ["siteUrl"],
      additionalProperties: false,
    }
    let includeAddedTool = false
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/api/tools") {
          return Response.json([
            {
              address,
              owner: "org",
              integration: "google_search_console",
              connection: "primary",
              name: "searchAnalytics.query",
              description: "Get Search Console performance",
            },
            ...(includeAddedTool
              ? [
                  {
                    address: addedAddress,
                    owner: "org",
                    integration: "google_search_console",
                    connection: "primary",
                    name: "sites.get",
                    description: "Get a Search Console site",
                  },
                ]
              : []),
          ])
        }
        if (url.pathname === "/api/integrations") {
          return Response.json([
            {
              slug: "google_search_console",
              name: "Google Search Console",
              description: "Search performance",
            },
          ])
        }
        if (url.pathname === "/api/semantic-search/search") {
          const added = url.searchParams.get("q")?.includes("site")
          return Response.json({
            items: [
              added
                ? {
                    path: "google_search_console.org.primary.sites.get",
                    name: "sites.get",
                    integration: "google_search_console",
                    score: 1,
                  }
                : {
                    path: "google_search_console.org.primary.searchAnalytics.query",
                    name: "searchAnalytics.query",
                    integration: "google_search_console",
                    score: 1,
                  },
            ],
          })
        }
        if (url.pathname === "/api/tools/schemas") {
          schemaRequests += 1
          if (schemaRequests === 1) {
            startFirstSchemaRequest()
            return stalledSchemaResponse
          }
          return Response.json([
            { address, inputSchema },
            ...(includeAddedTool ? [{ address: addedAddress, inputSchema: addedInputSchema }] : []),
          ])
        }
        return new Response("not found", { status: 404 })
      },
    })
    const directory = await mkdtemp(join(tmpdir(), "opencode-executor-test-"))
    const secretFile = join(directory, "secret")
    await writeFile(secretFile, "test-secret")
    process.env.EXECUTOR_BASE_URL = server.url.toString().replace(/\/$/, "")
    process.env.EXECUTOR_CLIENT_ID = "test-client"
    process.env.EXECUTOR_CLIENT_SECRET_FILE = secretFile

    let transform: ((editor: ToolEditor) => void) | undefined
    let reloads = 0
    const tools = new Map<string, OpenCodeTool>()
    const replay = () => {
      tools.clear()
      transform?.({
        namespace() {},
        add(tool) {
          tools.set(`${tool.options?.namespace ?? ""}.${tool.name}`, tool)
        },
        update() {},
        remove() {},
        list: () => [...tools.values()],
        get: (id) => tools.get(id),
      })
    }
    const context: PluginContext = {
      tool: {
        transform: (callback) =>
          Effect.sync(() => {
            transform = callback
            replay()
            return { dispose: Effect.void }
          }),
        reload: () =>
          Effect.sync(() => {
            reloads += 1
            replay()
          }),
      },
    }
    const scope = await Effect.runPromise(Scope.make())

    try {
      await Effect.runPromise(plugin.effect(context).pipe(Scope.provide(scope)))
      await firstSchemaRequest
      const search = tools.get("executor.search")
      expect(search).toBeDefined()

      const result = await Effect.runPromise(search!.execute({ query: "search performance" }, {}))

      expect(result.output).toEqual({
        items: [
          {
            path: "google_search_console.primary.searchAnalytics.query",
            score: 1,
          },
        ],
      })
      expect(tools.get("google_search_console.primary.searchAnalytics.query")?.input).toEqual(inputSchema)
      expect(reloads).toBe(1)
      expect(schemaRequests).toBe(2)

      const warmResult = await Effect.runPromise(search!.execute({ query: "search performance" }, {}))
      expect(warmResult.output).toEqual(result.output)
      expect(reloads).toBe(2)
      expect(schemaRequests).toBe(2)

      includeAddedTool = true
      const refresh = tools.get("executor.refresh")
      expect(refresh).toBeDefined()
      await Effect.runPromise(refresh!.execute({}, {}))
      const addedResult = await Effect.runPromise(search!.execute({ query: "get site" }, {}))

      expect(addedResult.output).toEqual({
        items: [
          {
            path: "google_search_console.primary.sites.get",
            score: 1,
          },
        ],
      })
      expect(tools.get("google_search_console.primary.sites.get")?.input).toEqual(addedInputSchema)
      expect(schemaRequests).toBeGreaterThan(2)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
