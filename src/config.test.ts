import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Option } from "effect"

import { envConfig, parseList, parseOptionalPositiveInt } from "./config.ts"

const parseEnv = (env: Record<string, string>) =>
  Effect.runSync(envConfig.parse(ConfigProvider.fromUnknown(env)))

describe("parseList", () => {
  test("splits, trims, and drops empties", () => {
    expect([...parseList("stripe_api, github_api ,,")]).toEqual(["stripe_api", "github_api"])
    expect(parseList("").size).toBe(0)
  })
})

describe("parseOptionalPositiveInt", () => {
  test("parses positive integers and treats everything else as absent", () => {
    expect(parseOptionalPositiveInt("25")).toBe(25)
    expect(parseOptionalPositiveInt("")).toBeUndefined()
    expect(parseOptionalPositiveInt("0")).toBeUndefined()
    expect(parseOptionalPositiveInt("nope")).toBeUndefined()
    expect(parseOptionalPositiveInt("-3")).toBeUndefined()
  })
})

describe("envConfig", () => {
  test("applies defaults when nothing is set", () => {
    const parsed = parseEnv({})
    expect(parsed.baseUrl).toBe("https://executor.arya.sh")
    expect(Option.isNone(parsed.clientId)).toBe(true)
    expect(parsed.clientIdFile.endsWith("executor-cf-access-client-id")).toBe(true)
    expect(parsed.secretFile.endsWith("executor-cf-access-client-secret")).toBe(true)
    expect(parsed.include.size).toBe(0)
    expect(parsed.limit).toBeUndefined()
    expect(parsed.schemas).toBe("on")
    expect(parsed.concurrency).toBeUndefined()
    expect(parsed.searchLimit).toBeUndefined()
  })

  test("parses provided values", () => {
    const parsed = parseEnv({
      EXECUTOR_BASE_URL: "https://example.test/",
      EXECUTOR_CLIENT_ID: "id.access",
      EXECUTOR_INCLUDE: "stripe_api, github_api",
      EXECUTOR_LIMIT: "25",
      EXECUTOR_SCHEMAS: "off",
      EXECUTOR_CONCURRENCY: "4",
      EXECUTOR_SEARCH_LIMIT: "5",
    })
    expect(parsed.baseUrl).toBe("https://example.test/")
    expect(Option.getOrUndefined(parsed.clientId)).toBe("id.access")
    expect([...parsed.include]).toEqual(["stripe_api", "github_api"])
    expect(parsed.limit).toBe(25)
    expect(parsed.schemas).toBe("off")
    expect(parsed.concurrency).toBe(4)
    expect(parsed.searchLimit).toBe(5)
  })
})
