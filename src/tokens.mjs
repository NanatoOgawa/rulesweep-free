// トークン推定（ライブラリ非依存・API不要）
//
// Claude 系トークナイザの実測傾向に寄せたヒューリスティック。
// - ラテン文字/記号/コード: おおむね 1 トークン ≈ 4 文字
// - CJK（日本語・中国語・韓国語）: 1 文字 ≈ 0.9〜1.1 トークン（本推定は 1.0）
// - 空白・改行はまとめて軽めに換算
//
// 正確な課金トークン数ではなく「どのセクションが重いか」の相対比較が目的。
// 実測との誤差は±15%程度を想定（README に明記）。

const CJK_RANGES = [
  [0x3000, 0x303f], // CJK 記号・句読点（、。「」（）等）
  [0x3040, 0x30ff], // ひらがな・カタカナ
  [0x3400, 0x4dbf], // CJK拡張A
  [0x4e00, 0x9fff], // CJK統合漢字
  [0xf900, 0xfaff], // CJK互換漢字
  [0xff01, 0xff60], // 全角ASCII・全角記号
  [0xff61, 0xff9f], // 半角カナ・半角記号
  [0xffe0, 0xffe6], // 全角通貨記号等
  [0xac00, 0xd7a3], // ハングル音節
];

function isCJK(codePoint) {
  for (const [lo, hi] of CJK_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/**
 * 文字列のトークン数を推定する。
 * @param {string} text
 * @returns {number} 推定トークン数（整数）
 */
export function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let latin = 0;
  let whitespace = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      whitespace += 1;
    } else if (isCJK(cp)) {
      cjk += 1;
    } else {
      latin += 1;
    }
  }
  // ラテンは 4 文字/トークン、CJK は 1.0 トークン/文字、空白は 12 文字/トークン
  const tokens = latin / 4 + cjk * 1.0 + whitespace / 12;
  return Math.max(0, Math.round(tokens));
}

/**
 * 推定の内訳（デバッグ・レポート用）。
 */
export function tokenBreakdown(text) {
  let cjk = 0;
  let latin = 0;
  let whitespace = 0;
  for (const ch of text || "") {
    const cp = ch.codePointAt(0);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") whitespace += 1;
    else if (isCJK(cp)) cjk += 1;
    else latin += 1;
  }
  return {
    chars: (text || "").length,
    cjkChars: cjk,
    latinChars: latin,
    whitespaceChars: whitespace,
    estimatedTokens: estimateTokens(text),
  };
}
