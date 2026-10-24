# Implementation Handoff — AI協調開発の文書基盤

## Metadata

- Updated: 2026-10-24
- Issue: この導入に対応するIssueなし。FE-01の[#3](https://github.com/jphacks/ng_2601/issues/3)は参照のみで、完了対象ではない
- PR: [#17](https://github.com/jphacks/ng_2601/pull/17)
- Branch: `norinori1/ai-collab-knowledge-base`（作業用に用意済みの専用ブランチを使用）
- Base / Saved Commit: mainの`c5e8aec728c92abbb6792770eb057dd44e21a423`を基準。保存済みコミットはこのファイルを含むPRのheadを参照
- Working Tree: 開始時クリーン。変更はこのPRの文書だけを保存する
- Status: レビュー待ち（マージ状態はPR参照）
- Author / Agent: Codex

## Objective

新しい開発者・AIが、過去チャットなしで実装状態・方針・残課題を確認し、Issueを安全に引き継げる軽量な文書基盤を導入する。

## Changes

作業開始・実装・完了時の規約、正本と参照の関係、矛盾解消手順、ADRとHandoffの作成条件、PR記録の入口を追加した。プロダクト実装は追加していない。

## Files

- [AGENTS.md](../../AGENTS.md): AI共通規約。[CLAUDE.md](../../CLAUDE.md)は参照のみ
- [docs/README.md](../README.md): 開発参加・読む順序・正本・運用
- [architecture.md](../architecture.md)、[api-contract.md](../api-contract.md): 確認済み状態と進行中の提案、未合意点の索引
- [decisions/README.md](../decisions/README.md): 必要時だけ使うADRの書式
- [handoffs/README.md](README.md)、[TEMPLATE.md](TEMPLATE.md)、本ファイル: 引き継ぎの条件・書式・導入記録
- [PRテンプレート](../../../.github/pull_request_template.md): 人間とAI共通の変更・検証・残課題の記録

## Design Decisions

- 外部サービスやDBを増やさず、GitHubとMarkdownで運用する。規約はAGENTS.mdに集約する。
- PR #16は未マージのため、mainの構成に組み込まない。暫定型とHTTP仕様は確認したheadへの固定リンクで参照し、型の複製を作らない。
- ルートREADMEは依頼者の指定により変更せず、開発参加案内をdocs/README.mdへ置く。
- FE-01の最新差分では開発手順は`frontend/README.md`に分離済みだった。PR本文の「READMEへ追記」だけを根拠にルートREADMEを変更しない。
- 過去の技術選定を後付けADRにしない。重要な今後の判断だけ記録する。

## Verification

- 実行場所: リポジトリルート。
- 実行コマンド・結果: `git diff --cached --check`成功。`git diff --exit-code HEAD -- README.md LICENSE`成功。`git diff --cached --name-only`で変更が10個のMarkdownだけであることを確認。
- 一時Python検査（標準ライブラリのスクリプトを`python -`へ渡して実行）: 10ファイルのUTF-8・コードフェンス・Handoff／PR必須節、58件の相対リンク、8件の固定Git参照の存在、AGENTS.mdから全10文書への到達を確認。認証情報の代表的なパターンも検査し、検出なし。
- 手動確認: 初参加者の読む順序と、FE-01を引き継ぐ際の最初の操作・未合意事項・参照先を確認。架空の起動手順やAPIの稼働を記載していないことを照合した。
- 検査中の失敗: 最初の一時検査ではGit内のLFとWindows上のCRLFをバイト比較してREADME／LICENSEを変更ありと誤判定した。`git hash-object --path`でGitの改行フィルターを適用して比較する方式へ修正し、再検査は成功。ファイル自体は変更していない。
- 未実施: アプリ起動、FEの型チェック・ビルド、BE接続・結合テスト。このブランチにプロダクト実装・実行設定がなく、文書変更だけのため。

## Known Limitations

- 正式なAPIは未合意。PreferencesのPATCH／PUT差、車種・範囲、地点口コミ、標高欠測などは[API契約の未合意事項](../api-contract.md)を参照する。この導入で解決した扱いにしない。
- 確認時点でIssue #1〜#15はOPEN、PR #16はOPEN・未マージ。他担当の作業を閉じたり取り込んだりしていない。
- 初めて使うAIが規約を自動読込しない場合、開発者がAGENTS.mdを読むよう指示する必要がある。

## Next Actions

1. レビュー担当はこのPRの文書と[開発参加案内](../README.md)を読み、Issue → 仕様 → PR → Handoffの経路とルールを確認する。
2. 次のFE担当は最初に[PR #16](https://github.com/jphacks/ng_2601/pull/16)の最新head・レビュー・マージ状態を確認する。別の基盤やAPI型を重複実装しない。
3. PR #16を取り込む際は、その担当が[アーキテクチャ](../architecture.md)の状態・基準コミットを更新し、API索引を実際の型・clientへの相対リンクへ切り替える。起動手順は取り込まれた`frontend/README.md`を参照する。
4. API接続を担当するFE・BEは[未合意事項](../api-contract.md)を関連Issueで調整し、正本・実装・モック・検証を揃える。

## References

- [FE Epic #2](https://github.com/jphacks/ng_2601/issues/2)、[FE-01 #3](https://github.com/jphacks/ng_2601/issues/3)、[PR #16](https://github.com/jphacks/ng_2601/pull/16)
- [資料の正本と矛盾の解決方法](../README.md)
- [LayerTraceのdocs](https://github.com/norinori1/LayerTrace/tree/main/docs): 編集範囲、実装記録、検証と次作業を残す思想を参考にした
