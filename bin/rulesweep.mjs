#!/usr/bin/env node
// rulesweep（無料版）専用エントリーポイント。
//
// 2026-08-31（🔴要決断#1・案B・adversarial-reviewer指摘対応）:
// `bin/rulesweep.mjs --free` という「同じ配布物にオプトインのフラグを足す」だけの
// 実装は、利用者がフラグを外して `audit --json` や `sort` を叩けば分類ロジック
// （`src/audit.mjs`のclassifySection＝商品の核心IP）がそのまま出てしまい、
// 実質的な保護になっていないと指摘された。これはフラグの問題ではなく配布物の
// 問題のため、無料版として実際に配布するのは常にこのファイル一本にする。
//
// 無料版リポジトリに含めるべきファイル（これ以外は含めないこと）:
//   bin/rulesweep-free.mjs（このファイル）
//   src/discover.mjs / src/tokens.mjs / src/audit.mjs / src/sections.mjs / src/report.mjs
// 含めてはいけないファイル（有料版のみ）:
//   src/sort.mjs / src/stub.mjs / src/rewrite.mjs / src/baseline.mjs / src/classify.mjs
//   bin/rulesweep.mjs（sort/stub/rewrite/remeasureへの導線を持つため）
//
// 2026-08-31（バックログ#3.7対応・完了）: classifySection()（有料版の判定ロジック
// ＝核心IP）は`src/classify.mjs`へ分離済み。audit.mjsは非summaryOnly時のみ
// 動的importするため、上記の通りclassify.mjsを同梱しなければ物理的にソースが
// 含まれない。audit.mjs自体は含めてよく（含めないと discover/report 等が壊れる）、
// 除去版を別途生成する必要はない——このファイル単体で完結する（配布は
// `launch/build-free-repo.sh`のホワイトリスト方式を使うこと。手動で組む場合も
// 上記2つの一覧を厳守する）。

import { existsSync } from "node:fs";
import path from "node:path";
const { resolve } = path;

import { discover } from "../src/discover.mjs";
import { runAudit } from "../src/audit.mjs";
import { renderConsoleFree } from "../src/report.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a === "--global") args.global = true;
    else if (a === "--json") args.json = true;
    else if (a === "--reload-factor") args.reloadFactor = Number(argv[++i]);
    else if (a === "-h" || a === "--help") args.help = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `rulesweep（無料版）— CLAUDE.md 継続スリム化キット・診断のみ

使い方:
  rulesweep-free audit [--root .] [--global] [--reload-factor N] [--json]

出力: ファイル別/合計トークン推定・重複行の件数・壊れた参照の件数・矛盾候補の件数。
どのセクションを skill/subagent に退避すべきか・具体的な直し方・修正後の削減幅の
記録・振り分けワークシート・スタブ生成・BYOKリライトは有料版でご利用いただけます。
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (args.help || !cmd) {
    console.log(HELP);
    process.exit(cmd ? 0 : 1);
  }
  if (cmd !== "audit") {
    console.error(`未知のサブコマンド: ${cmd}（無料版は audit のみ対応）\n`);
    console.log(HELP);
    process.exit(1);
  }
  const root = resolve(args.root || process.cwd());
  if (!existsSync(root)) {
    console.error(`ルートが見つかりません: ${root}`);
    process.exit(2);
  }
  const disc = discover(root, { global: args.global });
  if (!disc.instructionFiles.length && !disc.ruleFiles.length) {
    console.error("CLAUDE.md / .claude/rules/*.md が見つかりませんでした。--root を確認してください。");
    process.exit(3);
  }
  const audit = await runAudit(disc, {
    subagentReloadFactor: args.reloadFactor || 1,
    summaryOnly: true, // 常に無料モード。CLIフラグで解除する経路を持たない
  });
  console.log(args.json ? JSON.stringify(audit, null, 2) : renderConsoleFree(audit));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
