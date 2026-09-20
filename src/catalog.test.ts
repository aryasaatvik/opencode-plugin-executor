import { describe, expect, test } from "bun:test"

import { codeModePath, filterSearchResults, integrationLine, registrationName } from "./catalog.ts"
import type { IntegrationSummary, SemanticSearchItem, ToolRow } from "./schemas.ts"

const row = (overrides: Partial<ToolRow> & Pick<ToolRow, "integration" | "connection" | "name">): ToolRow => ({
  owner: "org",
  address: `tools.${overrides.integration}.org.${overrides.connection}.${overrides.name}`,
  ...overrides,
})

const integration = (overrides: Partial<IntegrationSummary> & Pick<IntegrationSummary, "slug">): IntegrationSummary => ({
  name: overrides.slug,
  description: "",
  ...overrides,
})

describe("registrationName", () => {
  test("preserves Executor's dots and drops the owner segment", () => {
    expect(registrationName(row({ integration: "gmail", connection: "main", name: "users.drafts.create" }))).toEqual({
      namespace: "gmail.main.users.drafts",
      leaf: "create",
    })
  })

  test("drops a leading name segment that repeats the connection", () => {
    expect(
      registrationName(row({ integration: "github_api", connection: "repos", name: "repos.get" })),
    ).toEqual({ namespace: "github_api.repos", leaf: "get" })
  })

  test("keeps the Executor coreTools hierarchy readable", () => {
    expect(
      registrationName(
        row({ integration: "executor", owner: "user", connection: "coreTools", name: "integrations.list" }),
      ),
    ).toEqual({ namespace: "executor.coreTools.integrations", leaf: "list" })
  })

  test("splits an over-long name into registrable segments", () => {
    const { namespace, leaf } = registrationName(
      row({ integration: "i", connection: "c", name: "a".repeat(80) }),
    )
    expect(leaf.length).toBeGreaterThan(0)
    expect(leaf.length).toBeLessThanOrEqual(64)
    for (const segment of namespace.split(".")) expect(segment.length).toBeLessThanOrEqual(64)
  })

  test("splits at a camel boundary rather than mid-word", () => {
    const { namespace, leaf } = registrationName(
      row({
        integration: "i",
        connection: "c",
        name: "fetchUsersByOrganizationWithAVeryLongSuffixBeyondSixtyFourCharacters",
      }),
    )
    expect(leaf.length).toBeLessThanOrEqual(64)
    expect(namespace.startsWith("i.c.fetchUsersByOrganization")).toBe(true)
  })
})

describe("integrationLine", () => {
  test("falls back to a count when the integration is unknown", () => {
    expect(integrationLine(undefined, 3)).toBe("3 Executor tools")
  })

  test("omits a description that just repeats the name", () => {
    expect(integrationLine(integration({ slug: "github_api", name: "GitHub", description: "GitHub" }), 5)).toBe("GitHub")
  })

  test("omits an over-long description", () => {
    expect(integrationLine(integration({ slug: "x", name: "X", description: "d".repeat(200) }), 5)).toBe("X")
  })

  test("joins a short, distinct description to the name", () => {
    expect(
      integrationLine(integration({ slug: "github_api", name: "GitHub", description: "Repos and issues" }), 5),
    ).toBe("GitHub — Repos and issues")
  })
})

describe("codeModePath", () => {
  test("drops the owner segment", () => {
    expect(codeModePath("stripe.org.main.customers.getCustomers")).toBe("stripe.main.customers.getCustomers")
  })

  test("returns undefined for non-tool addresses", () => {
    expect(codeModePath("a.b")).toBeUndefined()
  })

  test("agrees with registrationName on the registered Code Mode path", () => {
    const tool = row({
      integration: "stripe_api",
      connection: "example",
      name: "customers.getCustomers",
    })
    const { namespace, leaf } = registrationName(tool)
    // Search results carry `integration.owner.connection.name`, not `tools.*`.
    expect(codeModePath("stripe_api.org.example.customers.getCustomers")).toBe(`${namespace}.${leaf}`)
  })
})

describe("filterSearchResults", () => {
  const item = (overrides: Partial<SemanticSearchItem> & Pick<SemanticSearchItem, "path">): SemanticSearchItem => ({
    name: "name",
    integration: "stripe",
    score: 0.5,
    ...overrides,
  })

  test("keeps only registered paths and maps them to Code Mode paths", () => {
    const registered = new Set(["stripe.main.customers.getCustomers"])
    const results = filterSearchResults(
      [
        item({ path: "stripe.org.main.customers.getCustomers", description: "List customers", score: 0.9 }),
        item({ path: "stripe.org.main.charges.create", score: 0.8 }),
        item({ path: "bad", score: 1 }),
      ],
      registered,
    )
    expect(results).toEqual([
      { path: "stripe.main.customers.getCustomers", description: "List customers", score: 0.9 },
    ])
  })

  test("returns nothing when no result maps to a registered path", () => {
    expect(filterSearchResults([item({ path: "stripe.org.main.charges.create" })], new Set())).toEqual([])
  })

  test("does not mutate its input", () => {
    const items = [item({ path: "stripe.org.main.customers.getCustomers" })]
    filterSearchResults(items, new Set(["stripe.main.customers.getCustomers"]))
    expect(items[0]?.path).toBe("stripe.org.main.customers.getCustomers")
  })
})
