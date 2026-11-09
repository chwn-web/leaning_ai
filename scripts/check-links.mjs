// 检查所有 Markdown 里的相对链接是否指向真实存在的文件。
// 用法（零依赖，Node 18+）：
//   node scripts/check-links.mjs
//   node scripts/check-links.mjs --verbose
//
// 为什么需要它：知识库有几十篇互相引用的笔记，改名/移动一次就会出现死链，
// 而"死链"是知识库慢慢烂掉的第一信号。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "data"]);
const verbose = process.argv.includes("--verbose");

/** 递归收集 .md 文件 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (extname(entry) === ".md") out.push(full);
  }
  return out;
}

/** 抽取 [text](target) 里的 target，忽略 http/https/mailto/锚点/绝对路径 */
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const INLINE_CODE_RE = /`[^`]*`/g;

function extractLinks(markdown) {
  // 去掉行内代码，避免把示例里的链接当成真链接
  const text = markdown.replace(INLINE_CODE_RE, "");
  const links = [];
  for (const m of text.matchAll(LINK_RE)) {
    let target = m[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+/)[0]; // 去掉 "title"
    if (/^(https?:|mailto:|tel:|#)/.test(target)) continue;
    if (target.startsWith("/")) continue; // 仓库绝对路径不校验
    links.push(target.split("#")[0]);
  }
  return links.filter(Boolean);
}

const files = walk(ROOT);
const broken = [];
let checked = 0;

for (const file of files) {
  const links = extractLinks(readFileSync(file, "utf8"));
  for (const link of links) {
    checked += 1;
    const target = resolve(dirname(file), link);
    let ok = false;
    try {
      ok = statSync(target).isFile() || statSync(target).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) broken.push({ from: relative(ROOT, file), link });
  }
}

console.log(`扫描 ${files.length} 个 md 文件，${checked} 个相对链接`);
if (broken.length === 0) {
  console.log("✅ 没有死链");
  process.exit(0);
}

console.log(`❌ 发现 ${broken.length} 个死链：`);
for (const b of broken) {
  console.log(`  ${b.from}  →  ${b.link}`);
  if (verbose) console.log(`     期望路径：${resolve(ROOT, b.from, "..", b.link)}`);
}
process.exit(1);
