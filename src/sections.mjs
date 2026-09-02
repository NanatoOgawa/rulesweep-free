// Markdown を見出し単位のセクションへ分割する（依存なしの簡易パーサ）。
//
// 目的は「どの塊が重いか」「どの塊を退避できるか」を判定する粒度の確保。
// 完全な Markdown AST は不要。fenced code block 内の "#" は見出しとして扱わない。

import { estimateTokens } from "./tokens.mjs";

/**
 * @typedef {Object} Section
 * @property {number} level    見出しレベル（1〜6）。ファイル冒頭の前文は level 0。
 * @property {string} heading  見出しテキスト（前文は ""）。
 * @property {string} slug     見出しの簡易スラッグ。
 * @property {number} startLine 1始まりの開始行。
 * @property {number} endLine   1始まりの終了行。
 * @property {string} body     見出し行を含まない本文。
 * @property {string} raw      見出し行を含む生テキスト。
 * @property {number} tokens   本文（見出し含む raw）の推定トークン。
 * @property {string[]} bullets 箇条書き/番号付きリストの各項目（1行に正規化）。
 */

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}\-]/gu, "")
    .slice(0, 60);
}

/**
 * @param {string} content
 * @returns {Section[]}
 */
export function splitSections(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let inFence = false;
  let fenceMarker = "";

  let current = {
    level: 0,
    heading: "",
    startLine: 1,
    lines: [],
  };

  const flush = (endLine) => {
    const raw = current.lines.join("\n");
    const bodyLines = current.level === 0 ? current.lines : current.lines.slice(1);
    const body = bodyLines.join("\n");
    sections.push({
      level: current.level,
      heading: current.heading,
      slug: slugify(current.heading || "(前文)"),
      startLine: current.startLine,
      endLine,
      body,
      raw,
      tokens: estimateTokens(raw),
      bullets: extractBullets(body),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
    }

    const headingMatch = !inFence && line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flush(lineNo - 1);
      current = {
        level: headingMatch[1].length,
        heading: headingMatch[2].trim(),
        startLine: lineNo,
        lines: [line],
      };
    } else {
      current.lines.push(line);
    }
  }
  flush(lines.length);

  // 完全に空の前文セクションは落とす
  return sections.filter(
    (s) => !(s.level === 0 && s.raw.trim() === "")
  );
}

/**
 * fenced code block 内の行を空行に置換して返す（行番号は保持）。
 * findDuplicates / findContradictions / findBrokenRefs が生テキストのコード例を
 * 誤検出しないための共有ヘルパ。
 * @param {string} content
 * @returns {string}
 */
export function blankFencedCode(content) {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let marker = "";
  return lines
    .map((line) => {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m) {
        const ch = m[1][0];
        if (!inFence) {
          inFence = true;
          marker = ch;
          return "";
        }
        if (ch === marker) {
          inFence = false;
          marker = "";
          return "";
        }
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

/**
 * 箇条書き・番号付きリストの項目を 1 行に正規化して返す。
 * - ネストした箇条書き（`  - sub`）はそれぞれ独立した項目になる。
 * - 箇条書きでないインデント継続行（折り返し）は直前の項目に連結する。
 */
export function extractBullets(body) {
  const lines = body.split(/\r?\n/);
  const bullets = [];
  let buf = null;
  let inFence = false;
  let fenceMarker = "";

  const push = () => {
    if (buf != null) {
      const norm = buf.replace(/\s+/g, " ").trim();
      if (norm) bullets.push(norm);
      buf = null;
    }
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const bulletMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (bulletMatch) {
      push();
      buf = bulletMatch[3];
    } else if (buf != null && line.trim() !== "" && /^\s+/.test(line)) {
      // 継続行
      buf += " " + line.trim();
    } else {
      push();
    }
  }
  push();
  return bullets;
}
