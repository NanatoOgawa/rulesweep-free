// 監査パス: 毎ターンのコスト、重複、矛盾の疑い、壊れた参照、一度きり vs 恒久 の分類。
//
// すべてヒューリスティック。誤検出前提で「確認すべき箇所」を挙げるのが目的。

import { existsSync } from "node:fs";
import path from "node:path";
const { join, dirname } = path;
import { estimateTokens } from "./tokens.mjs";
import { splitSections, blankFencedCode } from "./sections.mjs";

// 総当たり比較の上限（大きな指示ファイル群でのハングを防ぐ）
const MAX_IMPERATIVES = 1200;

// パスに見えるがファイルではない拡張子（壊れ参照から除外）
const NON_FILE_EXT = new Set([
  "com", "io", "org", "net", "dev", "git", "lock", "sh", "example",
]);

// --- 重複検出 --------------------------------------------------------------
function normalizeLine(s) {
  return s
    .toLowerCase()
    .replace(/[`*_~>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ファイル横断で、正規化後に一致する意味のある行（20 文字以上）を検出。
 */
export function findDuplicates(files) {
  const map = new Map(); // normLine -> [{file, line, text}]
  for (const f of files) {
    const lines = blankFencedCode(f.content).split(/\r?\n/);
    lines.forEach((raw, idx) => {
      const norm = normalizeLine(raw);
      // 意味のある行だけ対象（短い見出し・区切り・単語1個は除外）。
      // 日本語は 1 文字あたりの情報量が多いので閾値は低め。
      if (norm.length < 12) return;
      if (!/\s/.test(norm) && norm.length < 8) return;
      if (!map.has(norm)) map.set(norm, []);
      map.get(norm).push({ file: f.rel, line: idx + 1, text: raw.trim() });
    });
  }
  const dups = [];
  for (const [norm, occ] of map) {
    if (occ.length >= 2) dups.push({ norm, occurrences: occ, tokensEach: estimateTokens(occ[0].text) });
  }
  return dups.sort((a, b) => b.occurrences.length - a.occurrences.length);
}

// --- 矛盾の疑い -----------------------------------------------------------
const NEGATION = /(しない|するな|禁止|してはならない|不可|避け|never|don't|do not|no\b)/i;
const AFFIRMATION = /(する|してよい|推奨|可|優先|always|do\b|use\b|prefer)/i;

/**
 * 語彙の重なりが大きいのに、片方が否定・片方が肯定の命令行ペアを「矛盾の疑い」として挙げる。
 */
export function findContradictions(files) {
  const imperatives = [];
  let truncated = false;
  for (const f of files) {
    blankFencedCode(f.content).split(/\r?\n/).forEach((raw, idx) => {
      const t = raw.trim();
      if (t.length < 12) return;
      if (!/[。.]$|しろ|すること|してください|べき|must|should/i.test(t) && !/^[-*]/.test(t)) return;
      if (imperatives.length >= MAX_IMPERATIVES) {
        truncated = true;
        return;
      }
      imperatives.push({
        file: f.rel,
        line: idx + 1,
        text: t,
        neg: NEGATION.test(t),
        aff: AFFIRMATION.test(t),
        tokens: new Set(tokenize(t)),
      });
    });
  }
  const hits = [];
  for (let i = 0; i < imperatives.length; i++) {
    for (let j = i + 1; j < imperatives.length; j++) {
      const a = imperatives[i];
      const b = imperatives[j];
      // 否定×肯定の組でなければ交差計算をスキップ（枝刈り）
      if (!((a.neg && b.aff && !b.neg) || (b.neg && a.aff && !a.neg))) continue;
      const overlap = intersectionSize(a.tokens, b.tokens);
      const minSize = Math.min(a.tokens.size, b.tokens.size);
      if (minSize < 3) continue;
      const ratio = overlap / minSize;
      if (ratio < 0.6) continue;
      hits.push({ a, b, overlapRatio: Number(ratio.toFixed(2)) });
    }
  }
  hits.truncated = truncated;
  return hits;
}

function tokenize(s) {
  const norm = normalizeLine(s);
  const words = norm.split(" ").filter((w) => w.length >= 2);
  // 日本語には空白がないため、正規化後の文字列から 2-gram も生成して
  // 語彙の重なりを言語非依存で拾えるようにする。
  const compact = norm.replace(/\s+/g, "");
  const bigrams = [];
  for (let i = 0; i < compact.length - 1; i++) {
    bigrams.push(compact.slice(i, i + 2));
  }
  return [...words, ...bigrams];
}
function intersectionSize(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

// --- 壊れた参照 ---------------------------------------------------------
// 対象:
//   - [[wikilink]]                     … 拡張子なし可。.md を補って存在確認
//   - `path/to/file.ext` / (link.ext)  … 明確なファイル拡張子を持つものだけ
//   - @path.ext / 素の a/b.ext         … 同上
// スラッシュコマンド（`/plugin` 等・拡張子なし）、グロブ（`*.md`）、URL、
// アンカー（#foo）は対象外（誤検出が多いため）。
const WIKILINK_RE = /\[\[([^\]\n|#]+?)(?:#[^\]\n]*)?\]\]/g;
// 誤検出を避けるため、非 wikilink は「スラッシュを含み」「拡張子が英字始まり」の
// ものだけを対象にする（メソッド呼び出し `chrome.tabs.create`、バージョン番号
// `4.5`、スラッシュコマンド `/plugin` を除外）。
const EXT = "[a-zA-Z][a-zA-Z0-9]{0,5}";
const PATH_REF_PATTERNS = [
  new RegExp("`([^`\\n]*?/[^`\\n]*?\\." + EXT + ")`", "g"),
  new RegExp("\\]\\(([^)\\s]*?/[^)\\s]*?\\." + EXT + ")\\)", "g"),
  new RegExp("(?:^|\\s)@([A-Za-z0-9_.~-]*/[A-Za-z0-9_./~-]*\\." + EXT + ")", "g"),
  new RegExp("(?:^|\\s)((?:[A-Za-z0-9_.~-]+/){1,}[A-Za-z0-9_.-]+\\." + EXT + ")", "g"),
];

function isGlobOrUrl(s) {
  return (
    /[*?]/.test(s) ||
    /^https?:/i.test(s) ||
    s.includes("://") ||
    /^#/.test(s) ||
    /\s/.test(s.trim())
  );
}

function resolveCandidates(ref, fileDir, root) {
  const stripAnchor = ref.replace(/[#].*$/, "");
  const out = [];
  for (const r of [stripAnchor, stripAnchor + ".md"]) {
    if (r.startsWith("~/")) out.push(join(process.env.HOME || "", r.slice(2)));
    else if (path.isAbsolute(r)) out.push(r);
    else {
      out.push(join(fileDir, r));
      out.push(join(root, r));
      out.push(join(root, ".claude", r));
    }
  }
  return out;
}

function isNonFileExt(ref) {
  const m = ref.replace(/[#].*$/, "").match(/\.([a-zA-Z][a-zA-Z0-9]{0,5})$/);
  return m ? NON_FILE_EXT.has(m[1].toLowerCase()) : false;
}

export function findBrokenRefs(files, root) {
  const broken = []; // 拡張子付きパスの実リンク切れ（確度高）
  const advisory = []; // wikilink など解決先が曖昧なもの（要目視）
  for (const f of files) {
    const lines = blankFencedCode(f.content).split(/\r?\n/);
    const fileDir = dirname(f.path);
    lines.forEach((line, idx) => {
      // wikilink（スペース可・拡張子なし可）→ 解決できなければ advisory 止まり
      WIKILINK_RE.lastIndex = 0;
      let wm;
      while ((wm = WIKILINK_RE.exec(line)) !== null) {
        const ref = (wm[1] || "").trim();
        if (!ref || /[*?]/.test(ref) || /^https?:/i.test(ref)) continue;
        const exists = resolveCandidates(ref, fileDir, root).some((c) => existsSync(c));
        if (!exists) {
          advisory.push({
            file: f.rel,
            line: idx + 1,
            ref,
            snippet: line.trim().slice(0, 120),
            note: "wikilink の解決先が見つからない（別 vault の可能性・要目視）",
          });
        }
      }
      // 明確な拡張子付きパス
      for (const re of PATH_REF_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const ref = (m[1] || "").trim();
          if (!ref || isGlobOrUrl(ref)) continue;
          if (!/\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(ref.replace(/[#].*$/, ""))) continue;
          if (isNonFileExt(ref)) continue;
          const exists = resolveCandidates(ref, fileDir, root).some((c) => existsSync(c));
          if (!exists) {
            broken.push({ file: f.rel, line: idx + 1, ref, snippet: line.trim().slice(0, 120) });
          }
        }
      }
    });
  }
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter((r) => {
      const k = r.file + "|" + r.ref;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const out = dedupe(broken);
  out.advisory = dedupe(advisory);
  return out;
}

// --- まとめ ---------------------------------------------------------------
/**
 * 2026-08-31（🔴要決断#1・案B承認）: 無料版はサマリのみを渡し、セクション単位の
 * KEEP/SKILL/SUBAGENT/DELETE判定・理由（＝この商品の核心IP）は渡さない方針が
 * 決まった（`products/rulesweep/launch/oss-free-tier-proposal.md`）。
 *
 * `opts.summaryOnly: true` のときは classifySection() を一切呼び出さず（movable
 * 自体を計算しない）、返り値にも classification / movable / 各検出の生データを
 * 含めない——レンダラ側で隠すのではなくデータ生成の時点で除外することで、
 * `--json` 経由でも核心IPが漏れないようにする。含めるのは提案書が明示した
 * 4項目（ファイル別/合計トークン、重複行の件数、壊れ参照の件数、矛盾候補の件数）
 * のみで、退避候補（movable）関連の数値は無料版の対象外として一切出さない。
 *
 * 2026-08-31（バックログ#3.7対応）: classifySection()の実装は`./classify.mjs`
 * （有料版の核心IP）に分離済み。ここでは非summaryOnly時のみ動的importする
 * ——静的importにすると、無料版配布物にclassify.mjsを含めなかった場合に
 * モジュール解決エラーで無料版自体が起動しなくなるため（ESMの静的importは
 * 使う使わないに関わらず読み込み時に解決される）。
 *
 * @param {ReturnType<import('./discover.mjs').discover>} disc
 * @param {{ subagentReloadFactor?: number, summaryOnly?: boolean }} opts
 */
export async function runAudit(disc, opts = {}) {
  const allFiles = [...disc.instructionFiles, ...disc.ruleFiles];
  const reloadFactor = opts.subagentReloadFactor ?? 1;
  const summaryOnly = opts.summaryOnly ?? false;

  const duplicates = findDuplicates(allFiles);
  const contradictions = findContradictions(allFiles);
  const brokenRefs = findBrokenRefs(allFiles, disc.root);

  if (summaryOnly) {
    const perFile = allFiles.map((f) => ({
      rel: f.rel,
      kind: f.kind || "rule",
      lines: f.content.split(/\r?\n/).length,
      chars: f.content.length,
      tokens: estimateTokens(f.content),
    }));
    const alwaysOnTokens = perFile
      .filter((f) => f.kind === "claude-md" || f.kind === "global-claude-md" || f.kind === "rule")
      .reduce((n, f) => n + f.tokens, 0);
    return {
      root: disc.root,
      summaryOnly: true,
      perFile,
      alwaysOnTokens,
      perTurnCost: alwaysOnTokens * reloadFactor,
      reloadFactor,
      duplicateCount: duplicates.length,
      contradictionCount: contradictions.length,
      // findContradictions は命令行が多いと MAX_IMPERATIVES で打ち切って比較する
      // （hits.truncated）。無料版でもこのフラグを落とすと「実際より少ない件数を
      // 確定値のように見せる」過少表示になるため、有料版と同じく引き継ぐ
      // （レビュー指摘）。
      contradictionsTruncated: !!contradictions.truncated,
      brokenRefCount: brokenRefs.length,
      brokenRefAdvisoryCount: (brokenRefs.advisory || []).length,
    };
  }

  const { classifySection } = await import("./classify.mjs");
  const perFile = allFiles.map((f) => {
    const sections = splitSections(f.content).map((s) => ({
      ...s,
      classification: classifySection(s),
    }));
    const tokens = estimateTokens(f.content);
    return {
      rel: f.rel,
      kind: f.kind || "rule",
      lines: f.content.split(/\r?\n/).length,
      chars: f.content.length,
      tokens,
      sections,
    };
  });

  const alwaysOnTokens = perFile
    .filter((f) => f.kind === "claude-md" || f.kind === "global-claude-md" || f.kind === "rule")
    .reduce((n, f) => n + f.tokens, 0);

  // 退避候補の合計トークン
  const movable = [];
  for (const f of perFile) {
    for (const s of f.sections) {
      if (s.classification.verdict !== "KEEP") {
        movable.push({
          file: f.rel,
          heading: s.heading || "(前文)",
          startLine: s.startLine,
          endLine: s.endLine,
          tokens: s.tokens,
          verdict: s.classification.verdict,
          reasons: s.classification.reasons,
        });
      }
    }
  }
  const movableTokens = movable.reduce((n, m) => n + m.tokens, 0);

  // 退避候補セクションの行範囲に含まれる重複は movableTokens 側で既に引かれるため、
  // dupWasteTokens からは「退避範囲外」の重複だけを数える（二重差し引きの回避）。
  const movableRanges = movable.map((m) => ({ file: m.file, from: m.startLine, to: m.endLine }));
  const inMovable = (occ) =>
    movableRanges.some((r) => r.file === occ.file && occ.line >= r.from && occ.line <= r.to);
  const dupWasteTokens = duplicates.reduce((n, d) => {
    const outside = d.occurrences.filter((o) => !inMovable(o));
    return n + d.tokensEach * Math.max(0, outside.length - 1);
  }, 0);

  return {
    root: disc.root,
    perFile,
    alwaysOnTokens,
    perTurnCost: alwaysOnTokens * reloadFactor,
    reloadFactor,
    duplicates,
    contradictions,
    brokenRefs,
    movable: movable.sort((a, b) => b.tokens - a.tokens),
    movableTokens,
    dupWasteTokens,
    projectedAfter: Math.max(0, alwaysOnTokens - movableTokens - dupWasteTokens),
  };
}
