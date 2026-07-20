import { describe, it, expect } from "vitest";
import { flattenToolSchema } from "@gateway/core/normalize";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { anyOfSchemaTool } from "./fixtures/anthropic-requests";

// Pitfall ⑪ — GLM rejects anyOf/oneOf/$ref/$defs in tool JSON-Schemas.
// flattenToolSchema must produce an equivalent schema with NONE of those
// keywords: anyOf/oneOf collapse to a single representative subschema, $ref is
// resolved against $defs (which is then removed).

function deepHasAnyKey(obj: any, keys: string[]): boolean {
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((v) => deepHasAnyKey(v, keys));
  for (const k of Object.keys(obj)) {
    if (keys.includes(k)) return true;
    if (deepHasAnyKey(obj[k], keys)) return true;
  }
  return false;
}

describe("pitfall-11 GLM schema flatten", () => {
  const banned = ["anyOf", "oneOf", "$ref", "$defs"];

  it("pitfall-11: fixture actually contains the banned keywords (guards vacuity)", () => {
    expect(deepHasAnyKey(anyOfSchemaTool.input_schema, banned)).toBe(true);
  });

  it("pitfall-11: flattened schema contains none of anyOf/oneOf/$ref/$defs", () => {
    const flat = flattenToolSchema(anyOfSchemaTool.input_schema);
    expect(deepHasAnyKey(flat, banned)).toBe(false);
  });

  it("pitfall-11: anyOf collapses to a concrete typed subschema", () => {
    const flat = flattenToolSchema(anyOfSchemaTool.input_schema);
    // value was anyOf[string, number] → keeps a usable `type`
    expect(flat.properties.value.type).toBeDefined();
    expect(deepHasAnyKey(flat.properties.value, banned)).toBe(false);
  });

  it("pitfall-11: $ref is resolved inline against $defs", () => {
    const flat = flattenToolSchema(anyOfSchemaTool.input_schema);
    // ref pointed at Named { properties.name }
    expect(flat.properties.ref.type).toBe("object");
    expect(flat.properties.ref.properties.name.type).toBe("string");
  });

  it("pitfall-11: preserves required and other benign keys", () => {
    const flat = flattenToolSchema(anyOfSchemaTool.input_schema);
    expect(flat.required).toEqual(["value"]);
    expect(flat.type).toBe("object");
  });

  it("pitfall-11: does not mutate the input schema", () => {
    const before = JSON.stringify(anyOfSchemaTool.input_schema);
    flattenToolSchema(anyOfSchemaTool.input_schema);
    expect(JSON.stringify(anyOfSchemaTool.input_schema)).toBe(before);
  });

  it("pitfall-11: end-to-end tool schema in OpenAI body is free of banned keywords", async () => {
    const req = {
      model: "glm-4",
      max_tokens: 100,
      messages: [{ role: "user" as const, content: "go" }],
      tools: [anyOfSchemaTool],
    };
    const { result: openai } = await anthropicToOpenAI(req, { flattenSchemas: true } as any);
    expect(deepHasAnyKey(openai.tools, banned)).toBe(false);
  });
});
