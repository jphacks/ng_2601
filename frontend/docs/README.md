# 開発参加・ドキュメント案内

このリポジトリでは、Issue → 専用ブランチで実装 → 検証 → PR（必要ならHandoff）→ 次の担当者、という流れで開発します。人間とAIは同じ資料を読み、GitとMarkdownで記録を共有します。

## 初めて参加する場合

```sh
git clone https://github.com/jphacks/ng_2601.git
cd ng_2601
git status --short --branch
```

1. [プロジェクトREADME](../../README.md)と[AGENTS.md](../AGENTS.md)を読む。AIが規約を自動読込しない場合は、AGENTS.mdを読むよう指示する。
2. [architecture.md](architecture.md)で現在の実装範囲と計画を、[api-contract.md](api-contract.md)で型・通信境界と未合意点を確認する。
3. [Issues](https://github.com/jphacks/ng_2601/issues)で担当タスク・受入条件・依存関係を確認し、[PR一覧](https://github.com/jphacks/ng_2601/pulls)から同じ機能の進行中変更を探す。
4. 対象機能に関係する[ADR](decisions/README.md)と[Handoff](handoffs/README.md)を読み、対象ブランチの実装・差分を確認する。IssueやPRのリンク先に記録があれば併せて読む。
5. 編集するファイルと担当範囲を調整し、専用ブランチで作業する。並行開発では別worktreeを使う。未コミット変更がある作業場所を使い回して消去しない。

clone直後に起動できる機能があるとは限りません。[アーキテクチャの確認時点](architecture.md)と実際のcheckoutを確認してください。起動・テスト手順は、そのブランチに存在する各実装のREADMEと設定ファイルを使います。未マージPRの起動コマンドをmain上で実行しないでください。

## 情報の正本

| 情報 | 正本・役割 |
| --- | --- |
| 製品概要・提出情報 | ルートの[README](../../README.md)。JPHACKS提出用テンプレートを維持する |
| 人間向け開発参加案内 | この文書。各資料への入口と運用手順 |
| AIの作業規約 | [AGENTS.md](../AGENTS.md)。[CLAUDE.md](../CLAUDE.md)は参照のみ |
| 現在の構成・責務・実装状態 | [architecture.md](architecture.md)。確認したコミットと根拠を添える |
| APIの構造・通信仕様 | [api-contract.md](api-contract.md)が案内する型・仕様を正本とする。独立した型の写しを作らない |
| 重要な判断の理由・履歴 | [decisions/](decisions/README.md)のADR。提案／採用／廃止を区別 |
| タスク・受入条件・担当範囲 | GitHub Issue。仕様の未合意点も関係Issueで追跡 |
| 変更・レビュー・検証記録 | GitHub PR。完了とマージ済みを区別 |
| 重要作業の引き継ぎ | [handoffs/](handoffs/README.md)。作業時点の記録であり、最新仕様を上書きしない |

## 矛盾がある場合

1. 対象のブランチ・コミット・確認日を揃え、マージ済み実装／仕様と未マージの提案を分ける。
2. 該当箇所と根拠（型、実装、Issueの合意、PRレビュー、ADR）を関係IssueまたはPRへ示す。実装は実際の挙動の根拠だが、要件への適合を自動的に証明するものではない。
3. FE・BEなど影響する担当者と、どの契約を採用するか確認する。チャットや古いHandoff、文書の更新日だけで優先順位を決めない。未合意の部分を推測で実装・確定しない。
4. 合意をIssue／PRに残し、同じ変更で正本とその参照を修正する。重要な設計変更ならADRを追加し、古い判断は後継ADRへリンクする。

## 完了・交代する場合

1. [PRテンプレート](../../.github/pull_request_template.md)に変更・判断・検証結果・未検証事項・残課題を書く。
2. [Handoffの条件](handoffs/README.md)に該当する場合は[TEMPLATE](handoffs/TEMPLATE.md)から作り、Issue・PR・Handoffを相互に辿れるようにする。小規模変更はPR本文を使う。
3. 次担当者は参照順に読み、ブランチとコミット、差分、未解決事項を照合し、Next Actionsの先頭から再開する。過去チャットの提出を前提にしない。

文書変更では相対リンク・参照パス・記載コマンドの存在を確認し、リポジトリルートで`git diff --check`を実行します。プロダクトの検証は各実装の手順に従い、未実施を成功扱いしません。

## 導入の参考

[LayerTraceのdocs](https://github.com/norinori1/LayerTrace/tree/main/docs)にある、仕様と実装記録の分離、編集範囲の明確化、判断・検証・次アクションの永続化を参考にしています。専用のオーケストレーター、ロック管理DB、AI別の規約は導入しません。
