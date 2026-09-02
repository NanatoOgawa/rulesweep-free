# rulesweep（free）— How much is your CLAUDE.md costing you per turn?

`CLAUDE.md`と`.claude/rules/`は、コードではなく**毎ターン・毎サブエージェント起動で再ロードされる固定コスト**です。ほとんどの人はこれを計測していません。

この無料版は、その事実をあなたに見せるための診断ツールです。

## 使い方

```bash
git clone https://github.com/NanatoOgawa/rulesweep-free
cd rulesweep-free
node bin/rulesweep.mjs audit --global --reload-factor 3
```

出力（サマリ）:
- ファイル別・合計のトークン推定（Claude Code が毎ターン読み込んでいる量）
- 重複行の件数（ファイル横断で同じことを繰り返し言っている箇所）
- 壊れた参照リンクの件数（存在しないファイルを指す`` `path.md` ``や`[[wikilink]]`）
- 矛盾候補の件数

無料版はここまでです。「どのセクションを skill/subagent に退避すべきか」「実際にどう直すか」「修正後にどれだけ削減できたか」の一歩先は、有料版（$29・[GUMROADリンク：要設定]）の`sort` / `stub` / `remeasure`ループで扱います。

### なぜ無料版はここで止めているのか

正直に書きます。判定ヒューリスティック（KEEP/SKILL/SUBAGENT/DELETEの振り分けロジック）はこのツールの核であり、そこから先（振り分けワークシート・退避スタブ自動生成・BYOKでのスリム版草案・before/after記録）は有料版の価値そのものです。無料版は「問題を見せる」ところまで、有料版は「直す」ところからです。

### 必要環境

Node.js 18+。API キー不要。

### AI利用について

このツール自体・このREADME・関連する発信物は Claude Code を使って作られています。それを隠していません（一次体験ベースの発信という方針のため）。ツールの実行自体にAPIキーは不要です。

### フル機能（有料版）が欲しい場合

→ [GUMROADリンク：要設定]（Gumroad: rulesweep $29。振り分けワークシート・退避スタブ自動生成・BYOKリライト・before/after計測）

### ライセンス

[LICENSE](./LICENSE) を参照（限定使用許諾。個人・商用問わず利用は自由ですが、ソースコードの複製・再配布・改変版の公開はできません）。
