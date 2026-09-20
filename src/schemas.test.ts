import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { ExecuteResponse, IntegrationSummary, SearchResponse, ToolRow } from "./schemas.ts"

describe("ToolRow", () => {
  test("decodes a full row", () => {
    const row = Schema.decodeUnknownSync(ToolRow)({
      address: "tools.stripe_api.org.example.customers.getCustomers",
      owner: "org",
      integration: "stripe_api",
      connection: "example",
      name: "customers.getCustomers",
      description: "List customers",
    })
    expect(row.integration).toBe("stripe_api")
    expect(row.pluginId).toBeUndefined()
  })

  test("rejects a row missing required fields", () => {
    expect(() => Schema.decodeUnknownSync(ToolRow)({ address: "tools.x" })).toThrow()
  })
})

describe("IntegrationSummary", () => {
  test("decodes with and without the optional kind", () => {
    expect(Schema.decodeUnknownSync(IntegrationSummary)({ slug: "stripe_api", name: "Stripe", description: "" }).kind).toBeUndefined()
    expect(
      Schema.decodeUnknownSync(IntegrationSummary)({ slug: "x", name: "X", description: "", kind: "openapi" }).kind,
    ).toBe("openapi")
  })
})

describe("ExecuteResponse", () => {
  test("decodes a completed envelope", () => {
    const body = Schema.decodeUnknownSync(ExecuteResponse)({
      status: "completed",
      text: "ok",
      structured: { result: 42 },
      isError: false,
    })
    expect(body.status).toBe("completed")
    expect(body.isError).toBe(false)
  })

  test("decodes a paused envelope", () => {
    const body = Schema.decodeUnknownSync(ExecuteResponse)({ status: "paused", text: "approve?" })
    expect(body.status).toBe("paused")
    expect(body.structured).toBeUndefined()
  })

  test("rejects an unknown status", () => {
    expect(() => Schema.decodeUnknownSync(ExecuteResponse)({ status: "pending" })).toThrow()
  })
})

describe("SearchResponse", () => {
  test("decodes items and a missing items field", () => {
    const withItems = Schema.decodeUnknownSync(SearchResponse)({
      items: [{ path: "stripe.org.main.customers.getCustomers", name: "getCustomers", integration: "stripe_api", score: 0.9 }],
    })
    expect(withItems.items?.length).toBe(1)
    expect(Schema.decodeUnknownSync(SearchResponse)({}).items).toBeUndefined()
  })
})
