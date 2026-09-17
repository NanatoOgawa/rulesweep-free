// 監査結果を人間向けテキスト / Markdown に整形する。

function bar(value, max, width = 24) {
  if (max <= 0) return " ".repeat(width);
  const n = Math.max(1, Math.round((value / max) * width));
  return "█".repeat(Math.min(width, n)) + " ".repeat(Math.max(0, width - n));
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

/**
 * コンソール向けの短いサマリ。
 */
export function renderConsole(audit) {
  const lines = [];
  lines.push("");
  lines.push("  rulesweep — 監査結果");
  lines.push("  " + "─".repeat(50));
  lines.push(`  常時ロードされる指示: 約 ${fmt(audit.alwaysOnTokens)} tok`);
  if (audit.reloadFactor > 1) {
    lines.push(
      `  サブエージェント込みの毎ターン概算: 約 ${fmt(audit.perTurnCost)} tok（×${audit.reloadFactor}）`
    );
  }
  lines.push("");

  const maxTok = Math.max(...audit.perFile.map((f) => f.tokens), 1);
  lines.push("  ファイル別:");
  for (const f of audit.perFile.sort((a, b) => b.tokens - a.tokens)) {
    lines.push(
      `    ${bar(f.tokens, maxTok)}  ${String(fmt(f.tokens)).padStart(6)} tok  ${f.rel}`
    );
  }
  lines.push("");

  lines.push(`  重複行: ${audit.duplicates.length} 種（無駄 約 ${fmt(audit.dupWasteTokens)} tok）`);
  lines.push(
    `  矛盾の疑い: ${audit.contradictions.length} 件` +
      (audit.contradictions.truncated ? "（命令行が多く一部のみ比較）" : "")
  );
  lines.push(
    `  壊れた参照: ${audit.brokenRefs.length} 件` +
      (audit.brokenRefs.advisory && audit.brokenRefs.advisory.length
        ? ` ＋ 要目視 ${audit.brokenRefs.advisory.length} 件（wikilink 等）`
        : "")
  );
  lines.push(`  退避候補セクション: ${audit.movable.length} 件（約 ${fmt(audit.movableTokens)} tok）`);
  lines.push("");
  lines.push(
    `  退避＋重複除去後の見込み: 約 ${fmt(audit.projectedAfter)} tok ` +
      `(${pct(audit.projectedAfter, audit.alwaysOnTokens)} / 削減 ${pct(
        audit.alwaysOnTokens - audit.projectedAfter,
        audit.alwaysOnTokens
      )})`
  );

  if (audit.brokenRefs.length) {
    lines.push("");
    lines.push("  壊れた参照（先頭 10 件）:");
    for (const r of audit.brokenRefs.slice(0, 10)) {
      lines.push(`    - ${r.file}:${r.line}  →  ${r.ref}`);
    }
  }

  lines.push("");
  lines.push("  次: `rulesweep sort` で振り分けワークシートを生成");
  lines.push("");
  return lines.join("\n");
}

/**
 * 無料版（summaryOnly の audit）向けのコンソール出力。
 * 2026-08-31（🔴要決断#1・案B）: ファイル別/合計トークンと各検出の「件数」のみを
 * 見せる。退避候補（movable）関連の数値・詳細は audit.mjs 側でそもそも計算されて
 * いないため、ここでも参照しない。
 */
export function renderConsoleFree(audit) {
  const lines = [];
  lines.push("");
  lines.push("  rulesweep（無料版）— 監査結果");
  lines.push("  " + "─".repeat(50));
  lines.push(`  常時ロードされる指示: 約 ${fmt(audit.alwaysOnTokens)} tok`);
  if (audit.reloadFactor > 1) {
    lines.push(
      `  サブエージェント込みの毎ターン概算: 約 ${fmt(audit.perTurnCost)} tok（×${audit.reloadFactor}）`
    );
  }
  lines.push("");

  const maxTok = Math.max(...audit.perFile.map((f) => f.tokens), 1);
  lines.push("  ファイル別:");
  for (const f of audit.perFile.slice().sort((a, b) => b.tokens - a.tokens)) {
    lines.push(
      `    ${bar(f.tokens, maxTok)}  ${String(fmt(f.tokens)).padStart(6)} tok  ${f.rel}`
    );
  }
  lines.push("");

  lines.push(`  重複行: ${fmt(audit.duplicateCount)} 種`);
  lines.push(
    `  矛盾の疑い: ${fmt(audit.contradictionCount)} 件` +
      (audit.contradictionsTruncated ? "（命令行が多く一部のみ比較）" : "")
  );
  lines.push(
    `  壊れた参照: ${fmt(audit.brokenRefCount)} 件` +
      (audit.brokenRefAdvisoryCount ? ` ＋ 要目視 ${fmt(audit.brokenRefAdvisoryCount)} 件（wikilink 等）` : "")
  );
  lines.push("");
  lines.push("  どのセクションを skill/subagent に退避すべきか・具体的な直し方・");
  lines.push("  修正後の削減幅の記録は有料版（sort / stub / rewrite / remeasure）で。");
  lines.push("  有料版: https://ogawana.gumroad.com/l/rulesweep");
  lines.push("");
  return lines.join("\n");
}

function pct(part, whole) {
  if (whole <= 0) return "0%";
  return Math.round((part / whole) * 100) + "%";
}

/**
 * 詳細な Markdown レポート（ファイルに保存する用）。
 */
export function renderMarkdown(audit) {
  const md = [];
  md.push("# rulesweep 監査レポート");
  md.push("");
  md.push(`- 対象ルート: \`${audit.root}\``);
  md.push(`- 生成: ${new Date().toISOString()}`);
  md.push(`- 常時ロード: **約 ${fmt(audit.alwaysOnTokens)} tok**`);
  if (audit.reloadFactor > 1) {
    md.push(`- サブエージェント込み毎ターン概算: 約 ${fmt(audit.perTurnCost)} tok（×${audit.reloadFactor}）`);
  }
  md.push(
    `- 退避＋重複除去後の見込み: 約 ${fmt(audit.projectedAfter)} tok（削減 ${pct(
      audit.alwaysOnTokens - audit.projectedAfter,
      audit.alwaysOnTokens
    )}）`
  );
  md.push("");
  md.push("> トークンは実測課金値ではなくヒューリスティック推定（±15% 目安）。相対比較に使う。");
  md.push("");

  md.push("## ファイル別");
  md.push("");
  md.push("| ファイル | 種別 | 行 | 推定トークン |");
  md.push("|---|---|---:|---:|");
  for (const f of audit.perFile.sort((a, b) => b.tokens - a.tokens)) {
    md.push(`| \`${f.rel}\` | ${f.kind} | ${f.lines} | ${fmt(f.tokens)} |`);
  }
  md.push("");

  md.push("## 退避候補セクション");
  md.push("");
  if (!audit.movable.length) {
    md.push("（なし）");
  } else {
    md.push("| ファイル | セクション | 行 | トークン | 提案 | 理由 |");
    md.push("|---|---|---|---:|---|---|");
    for (const m of audit.movable) {
      md.push(
        `| \`${m.file}\` | ${escapePipe(m.heading)} | ${m.startLine}–${m.endLine} | ${fmt(
          m.tokens
        )} | **${m.verdict}** | ${escapePipe(m.reasons.join(" / "))} |`
      );
    }
  }
  md.push("");

  md.push("## 重複行");
  md.push("");
  if (!audit.duplicates.length) {
    md.push("（なし）");
  } else {
    for (const d of audit.duplicates.slice(0, 40)) {
      md.push(`- \`${escapePipe(d.occurrences[0].text.slice(0, 100))}\``);
      for (const o of d.occurrences) md.push(`  - ${o.file}:${o.line}`);
    }
  }
  md.push("");

  md.push("## 矛盾の疑い");
  md.push("");
  if (!audit.contradictions.length) {
    md.push("（なし）");
  } else {
    for (const c of audit.contradictions) {
      md.push(`- 重なり ${c.overlapRatio}`);
      md.push(`  - ${c.a.file}:${c.a.line} — ${escapePipe(c.a.text.slice(0, 120))}`);
      md.push(`  - ${c.b.file}:${c.b.line} — ${escapePipe(c.b.text.slice(0, 120))}`);
    }
  }
  md.push("");

  md.push("## 壊れた参照");
  md.push("");
  if (!audit.brokenRefs.length) {
    md.push("（なし）");
  } else {
    md.push("| ファイル:行 | 参照先 | 該当行 |");
    md.push("|---|---|---|");
    for (const r of audit.brokenRefs) {
      md.push(`| ${r.file}:${r.line} | \`${escapePipe(r.ref)}\` | ${escapePipe(r.snippet)} |`);
    }
  }
  md.push("");
  return md.join("\n");
}

function escapePipe(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export { fmt, pct };
