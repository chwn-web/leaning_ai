import * as fs from "node:fs";

export interface GoldenCase {
  id: string;
  input: string;
  expected?: string;
  tags: string[];
}

function parseCase(line: string): GoldenCase {
  const value = JSON.parse(line) as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error('field "id" must be a non-empty string');
  }
  if (typeof value.input !== "string" || value.input.length === 0) {
    throw new Error('field "input" must be a non-empty string');
  }
  if (value.expected !== undefined && typeof value.expected !== "string") {
    throw new Error('field "expected" must be a string when present');
  }
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
    throw new Error('field "tags" must be an array of strings');
  }
  return {
    id: value.id,
    input: value.input,
    ...(value.expected !== undefined ? { expected: value.expected } : {}),
    tags: value.tags as string[],
  };
}

/**
 * 逐行读取 golden 数据。坏行打印行号后跳过，单个坏行不能拖垮整批评测。
 */
export async function loadGolden(filePath: string): Promise<GoldenCase[]> {
  const content = await fs.promises.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const cases: GoldenCase[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    try {
      cases.push(parseCase(line));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[golden] skip line ${index + 1}: ${message}`);
    }
  }

  return cases;
}
