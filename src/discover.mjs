// プロジェクト内の「毎ターン読まれる指示ファイル」と、退避先の既存スキル/サブエージェントを探索する。
//
// 対象:
//   - <root>/CLAUDE.md, <root>/.claude/CLAUDE.md
//   - ネストした **/CLAUDE.md（node_modules 等は除外）
//   - <root>/.claude/rules/*.md
//   - AGENTS.md / GEMINI.md（他ハーネス併用時の参考）
//   - ~/.claude/CLAUDE.md（--global 指定時のみ）
// 併せて既存の .claude/skills/*/SKILL.md と .claude/agents/*.md を列挙（重複退避の検出用）。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "vendor",
  ".claude/worktrees",
]);

const INSTRUCTION_BASENAMES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];

function walk(dir, root, acc, depth) {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if ([...IGNORE_DIRS].some((d) => rel === d || rel.startsWith(d + "/"))) continue;
      if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
      walk(full, root, acc, depth + 1);
    } else if (INSTRUCTION_BASENAMES.includes(entry.name)) {
      acc.push(full);
    }
  }
}

/**
 * @param {string} root プロジェクトルート
 * @param {{ global?: boolean }} opts
 * @returns {{
 *   instructionFiles: {path: string, rel: string, kind: string, content: string}[],
 *   ruleFiles: {path: string, rel: string, content: string}[],
 *   existingSkills: string[],
 *   existingAgents: string[],
 *   root: string,
 * }}
 */
export function discover(root, opts = {}) {
  const abs = root;
  const instructionPaths = [];
  walk(abs, abs, instructionPaths, 0);

  // .claude/rules/*.md
  const ruleFiles = [];
  const rulesDir = join(abs, ".claude", "rules");
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir)) {
      if (name.endsWith(".md")) {
        const p = join(rulesDir, name);
        ruleFiles.push({
          path: p,
          rel: relative(abs, p),
          content: safeRead(p),
        });
      }
    }
  }

  // グローバル CLAUDE.md
  if (opts.global) {
    const g = join(homedir(), ".claude", "CLAUDE.md");
    if (existsSync(g)) instructionPaths.push(g);
  }

  const seen = new Set();
  const instructionFiles = [];
  for (const p of instructionPaths) {
    if (seen.has(p)) continue;
    seen.add(p);
    const rel = p.startsWith(abs) ? relative(abs, p) : p.replace(homedir(), "~");
    instructionFiles.push({
      path: p,
      rel,
      kind: p.endsWith("CLAUDE.md")
        ? rel.startsWith("~")
          ? "global-claude-md"
          : "claude-md"
        : p.endsWith("AGENTS.md")
        ? "agents-md"
        : "gemini-md",
      content: safeRead(p),
    });
  }

  // 既存の退避先
  const existingSkills = [];
  const skillsDir = join(abs, ".claude", "skills");
  if (existsSync(skillsDir)) {
    for (const name of safeReaddir(skillsDir)) {
      const skillFile = join(skillsDir, name, "SKILL.md");
      if (existsSync(skillFile)) existingSkills.push(relative(abs, skillFile));
    }
  }
  const existingAgents = [];
  for (const d of [join(abs, ".claude", "agents"), join(abs, ".claude", "subagents")]) {
    if (existsSync(d)) {
      for (const name of safeReaddir(d)) {
        if (name.endsWith(".md")) existingAgents.push(relative(abs, join(d, name)));
      }
    }
  }

  return { instructionFiles, ruleFiles, existingSkills, existingAgents, root: abs };
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function safeReaddir(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

export { safeRead };
