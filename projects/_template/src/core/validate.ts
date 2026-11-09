import type { ParamSchema, ToolSpec } from "./types.ts";

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: string[] };

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function preview(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return String(value);
  }
}

function typeMatches(type: ParamSchema["type"], value: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  return false;
}

/**
 * 一次性收集所有参数问题，而不是遇到第一个就返回。
 *
 * 模型需要看到完整、具体、可行动的 observation：字段名、期望类型、实际值都要有。
 */
export function validateArgs(spec: ToolSpec, args: unknown): ValidationResult {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return {
      ok: false,
      errors: [`arguments for tool "${spec.name}" must be an object, got ${describeValue(args)}`],
    };
  }

  const input = args as Record<string, unknown>;
  const errors: string[] = [];

  for (const [fieldName, schema] of Object.entries(spec.params)) {
    const present = Object.prototype.hasOwnProperty.call(input, fieldName);
    if (!present) {
      if (schema.required) {
        errors.push(`missing required field "${fieldName}" (${schema.type}): ${schema.description}`);
      }
      continue;
    }

    const value = input[fieldName];
    if (!typeMatches(schema.type, value)) {
      errors.push(
        `field "${fieldName}" must be ${schema.type}, got ${describeValue(value)} (${preview(value)})`,
      );
      continue;
    }

    if (schema.enum && !schema.enum.includes(value as string)) {
      errors.push(
        `field "${fieldName}" must be one of [${schema.enum.join(", ")}], got ${preview(value)}`,
      );
    }

    if (schema.type === "number") {
      const numeric = value as number;
      if (schema.minimum !== undefined && numeric < schema.minimum) {
        errors.push(`field "${fieldName}" must be >= ${schema.minimum}, got ${numeric}`);
      }
      if (schema.maximum !== undefined && numeric > schema.maximum) {
        errors.push(`field "${fieldName}" must be <= ${schema.maximum}, got ${numeric}`);
      }
    }

    if (schema.type === "string") {
      const text = value as string;
      if (schema.minLength !== undefined && text.length < schema.minLength) {
        errors.push(
          `field "${fieldName}" must have at least ${schema.minLength} character(s), got ${text.length}`,
        );
      }
      if (schema.maxLength !== undefined && text.length > schema.maxLength) {
        errors.push(
          `field "${fieldName}" must have at most ${schema.maxLength} character(s), got ${text.length}`,
        );
      }
      if (schema.pattern !== undefined) {
        try {
          const regex = new RegExp(schema.pattern);
          if (!regex.test(text)) {
            errors.push(
              `field "${fieldName}" does not match pattern ${schema.pattern}, got ${preview(text)}`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`field "${fieldName}" has an invalid pattern in its schema: ${message}`);
        }
      }
    }
  }

  for (const fieldName of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(spec.params, fieldName)) {
      errors.push(`unknown field "${fieldName}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input };
}
