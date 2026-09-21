# FlowUI Skills 実装タスク

状態: 全タスク未着手。設計は `detailed-design.md` を参照する。

タスクは実装作業の分割単位であり、Codex上の新規タスクやサブエージェントを作成するものではない。番号順を基本とし、依存タスクの完了条件を満たしてから着手する。

## 1. マイルストーン

| 段階 | 対象 | 到達点 |
|---|---|---|
| M1 | T01–T04 | 契約・保存・秘匿化の共通基盤 |
| M2 | T05–T09 | ブラウザ観測と安全なCapture |
| M3 | T10–T13 | Scenarioの検証とAssist/Test実行 |
| M4 | T14–T17 | Record、補助CLI、Test生成 |
| M5 | T18–T20 | Skills、Adapter、導入・総合検証 |

優先順は「観測する → 一意に特定する → 許可を確認する → 操作する」。安全基盤より先に自動操作を公開しない。

## 2. タスク詳細

### T01: プロジェクト基盤

- 依存: なし。
- 対象: root package設定、`packages/cli`、テスト設定、README、LICENSE。
- 作業: ランタイムと依存版を公式資料で確認・固定し、CLI入口とモジュール境界、build/lint/typecheck/testを整備する。配布名は仮に `@company/flowui-skills` とし、公開前に所有namespaceを確認する。
- 完了条件: clean installからbuildとCLI helpが動作する。対象アプリのsrcへの依存がない。ライセンス未指定なら公開判断を保留し、勝手にライセンスを選定しない。

### T02: Schemaと意味検証

- 依存: T01。
- 対象: `schemas/`、`shared/contracts`、`validate`。
- 作業: Model・Scenario・Observation・Recorded Action・Result・PolicyのSchema、版管理規則、構造検証、参照整合性検証を実装する。
- 完了条件: 正常Fixtureが通る。未知major、重複ID、存在しないTarget、action/assert混在、平文secret、未解決Targetを含むready Scenarioが拒否される。
- 検証: Schemaごとの正常・異常契約テスト。

### T03: Store・ハッシュ・差分

- 依存: T02。
- 対象: `knowledge/`、`shared/storage`、`diff`。
- 作業: `.flowui`配置、正規化ハッシュ、原子的保存、楽観的排他、IDベース差分、Model候補の保存とacceptを実装する。観測時刻等の非意味的変更を差分表示で区別する。
- 完了条件: 競合したacceptは既存Modelを上書きしない。順序だけの差分と実際の属性変更を区別できる。パストラバーサルを拒否する。
- 検証: 保存失敗、同時更新、論理ID維持のテスト。

### T04: 秘匿化と出力制限

- 依存: T02。
- 対象: `shared/redaction`、出力・ログ境界、秘匿化設定。
- 作業: password/設定フィールド/URLの機密値除去、secret参照、共通ログフィルター、出力サイズ制限を実装する。ブラウザ取得側でも使用できる規則を用意する。
- 完了条件: 機密Fixtureの値が成果物・例外・標準出力・標準エラーに出ない。上限超過がpartialとして表現される。
- 検証: 個別経路とネストしたエラーの漏えい検査。ブラウザ連携はT06/T14で追加確認する。

### T05: Session ServiceとBrowser Adapter

- 依存: T01、T02、T04。
- 対象: `session/`、`browser/`、sessionコマンド。
- 作業: 可視ブラウザの起動・保持、ユーザー専用IPC、Session/Tab ID、状態遷移、操作ロック、接続切断通知を実装する。
- 完了条件: CLI終了後もブラウザが残る。closeだけが終了する。Tabの暗黙切替や複数実行が拒否される。接続秘密がログに出ない。
- 検証: 複数CLIから同一Sessionへの接続、ロック競合、Tab閉鎖、Service切断の統合テスト。

### T06: Page観測

- 依存: T04、T05。
- 対象: `observation/`、`inspect`。
- 作業: semantic role/name/label、Heading、操作可能要素、Form、State、Locator候補を抽出する。取得前の秘匿化と上限を適用する。
- 完了条件: 生DOM全文を出力しない。値は既定で収集しない。非対応領域と切り詰めを明示する。観測だけでclickやsubmitが起きない。
- 検証: 通常HTML・SPA・Dialog・Tab・Accordion・機密フォームのブラウザFixture。

### T07: Table抽出

- 依存: T06。
- 対象: `observation/table`、`inspect table`。
- 作業: 列の正規化、行数と部分範囲、limit/columns/where/matching-only/metadata-onlyを実装する。
- 完了条件: 大量行を既定で返さない。条件は任意コードを評価しない。ページング・仮想化の未観測部分を明示する。
- 検証: 重複列名、欠損セル、重複表示値、大量行、ページングのFixture。

### T08: Page Identity・Capture

- 依存: T03、T06、T07。
- 対象: `knowledge/identity`、`capture`、`pages.yaml`。
- 作業: URLと必須landmarkの照合、新規候補、既存差分、台帳登録を実装する。非操作Captureを先に完成させる。
- 完了条件: 同一URLで画面を区別できる。0件・複数件一致を停止条件として返す。unknownを既知に押し込まない。既存Modelの更新はaccept経由のみ。
- 検証: 同一URLの画面切替、landmark欠落、重複一致、古い候補のaccept。

### T09: Target Resolver

- 依存: T07、T08。
- 対象: `resolver/`、`resolve-target`。
- 作業: Page・論理Target・Table/row/elementの解決、候補数、根拠、明示indexの前提検証を実装する。
- 完了条件: 1件のみ成功し、0件・複数件は停止。Locatorの失敗を先頭要素やindexで代替しない。解決処理は操作を起こさない。
- 検証: Tableソート、重複行、消失要素、非表示要素、複数の同名Button。

### T10: Safety Gateと許可

- 依存: T02、T05、T09。
- 対象: `safety/`、`policy.yaml`、`permit`。
- 作業: 4分類、根拠検証、環境/origin/Scenario/Model/Action/対象/入力制約/期限の照合、許可の発行・失効を実装する。
- 完了条件: unknownは許可だけで通過しない。Scenario・Model・対象変更や期限切れで停止する。有効な許可で不要な再確認をしない。
- 検証: 実際にAdapterへ操作が送られないことを検証する拒否テスト。navigate・Enter送信・自動保存入力を含める。

### T11: Scenario入力・事前検証

- 依存: T02、T08、T09、T10。
- 対象: `scenario/validation`、入力解決、Scenarioテンプレート。
- 作業: draft/ready、操作と期待結果の分離、input/secret解決、停止Step検証、参照Model固定を実装する。
- 完了条件: draftのTest実行、存在しないpause-before、未指定入力をブラウザ操作前に拒否する。secret実値はスナップショットに保存しない。
- 検証: 正常/異常Scenarioと入力契約テスト。

### T12: 逐次Engine・Assist・Test

- 依存: T05、T08、T09、T10、T11。
- 対象: `scenario/engine`、`run`。
- 作業: 観測→一意解決→Gate→操作→結果観測、Assertion待機、pause-before、未知状態停止、操作結果不明の処理を実装する。
- 完了条件: 保存前停止で状態が残る。Gateを操作直前に再評価する。操作を自動再送しない。Assertionなしはcompleted、全検証成功時だけpassedとなる。
- 検証: 保存回数を数えるFixture、期限内表示、Assertion不一致、未知Dialog、実行中ユーザー操作、操作送信後切断。

### T13: Result・スナップショット・手動再開

- 依存: T03、T04、T12。
- 対象: `scenario/results`、`resume`。
- 作業: 実行開始時の固定成果物、Step証跡、reason code、終了コード、停止後の再観測と新Run作成を実装する。
- 完了条件: 実行中のModel更新が実行の期待結果を変えない。再開で過去Runを書き換えず、選択したStepより前の操作を勝手に再実行しない。
- 検証: Model変更中のRun、再開前の画面変更、キャンセル、結果保存失敗、CLI終了コード。

### T14: Recordイベント取得

- 依存: T04、T05、T06、T08。
- 対象: `record/collector`、`record start/stop/status`。
- 作業: ユーザーイベントの購読、文書ID・連番、取得時秘匿化、ページ遷移後再購読、未知ページの非操作Captureを実装する。
- 完了条件: 遷移後も順序が維持される。機密値がキューへ入らない。欠落・オーバーフローを成功扱いしない。Recordがユーザー操作を代行しない。
- 検証: 文書遷移・SPA遷移・連続入力・購読切断・機密入力の統合テスト。

### T15: Record正規化・Scenario候補

- 依存: T09、T11、T14。
- 対象: `record/normalize`、`normalize-record`。
- 作業: イベントID重複除去、操作境界内のinput統合、既知ID対応、遷移結果の分離、候補出力を実装する。
- 完了条件: 異なるclickを落とさず、clickに続く遷移をnavigateとして二重実行しない。未解決Target・未確認Assertionを含む候補はdraftのまま。
- 検証: 同じイベント列で同じ正規化結果になること、input→blur→click、連続click、未知ページ遷移のFixture。

### T16: 境界値導出

- 依存: T02、T06、T11。
- 対象: `derive-value`。
- 作業: 数値min/max/stepと文字数制約からbelow/at/above候補を決定論的に計算する。根拠制約を結果に含める。
- 完了条件: 制約不明なら生成しない。業務的に有効と断定しない。小数の丸めやstep基準を定義し、再現可能な値を返す。
- 検証: 整数、小数、片側境界、矛盾制約、文字数の定義に対応したテスト。

### T17: Playwright Test生成

- 依存: T10、T12、T13。
- 対象: `render/`、`render playwright`、実行用公開API。
- 作業: 共通Engineを呼ぶコード、必要なModel/Scenarioの固定参照、Fixture統合契約を生成する。
- 完了条件: 生成物がコンパイル・実行できる。許可・secretを埋め込まない。blocked/failed/completedをTest成功に変換しない。Gateを回避する直書き操作を生成しない。
- 検証: 同一ScenarioのCLI実行と生成Testで判定・操作回数・秘匿化が一致する統合テスト。

### T18: 7つのCore Skill

- 依存: T08–T17。
- 対象: `skills/`、各references。
- 作業: 日本語概要と英語実行指示、責務・非責務、CLI利用、停止条件、成果物契約を記述する。自然言語とRecordからScenarioを作る例を含める。
- 完了条件: 必須Sectionが揃い、実装済みCLIと一致する。期待結果を観測だけから確定する指示や、未知操作を実行する指示がない。
- 検証: 文書の構造・参照チェックと代表的な自然言語依頼の手動通し確認。

### T19: 初期化・Adapter・更新・配布準備

- 依存: T03、T18。
- 対象: `init`、`adapter setup`、`update`、`templates/`、`adapters/`、配布設定。
- 作業: ソース不要の初期化、canonical Skillの導入、設定テンプレート、変更済みファイルの保護、READMEの導入手順を実装する。
- 完了条件: 空ディレクトリへ導入できる。再実行が冪等。更新でユーザー編集を失わない。両AgentのSkillが同じ規則を参照する。packした成果物に必要Schema等が含まれる。
- 検証: clean installとpack内容、既存プロジェクトでの再導入・更新差分チェック。外部への公開は別作業とする。

### T20: MVP総合検証・引き渡し

- 依存: T01–T19。
- 対象: `tests/e2e`、ブラウザFixture、READMEの制限・運用例。
- 作業: ソースなし利用、4 Mode、CLIと生成Test、安全停止、秘匿化、導入更新を通して検証する。
- 完了条件: 詳細設計11章の全受け入れ条件を満たし、下表の証跡が残る。未対応機能と停止理由をREADMEで確認できる。
- 検証: 必須受け入れシナリオを自動化し、Assist停止後の手動引き継ぎは可視ブラウザでも確認する。

## 3. 必須受け入れシナリオ

| ID | シナリオ | 主担当タスク |
|---|---|---|
| A01 | 空プロジェクトへ導入し、ソースなしでCapture | T19、T20 |
| A02 | 同一URLで別画面へ移動し、正しいPageを識別 | T08 |
| A03 | 未知ページで停止し候補だけを保存 | T08、T12、T13 |
| A04 | 保存直前にAssist停止し、人間が保存 | T12、T20 |
| A05 | 期限切れ許可・対象変更・unknown操作を拒否 | T10 |
| A06 | 重複したTable行を誤操作せず停止 | T07、T09 |
| A07 | 遷移を含むRecordが候補になり、二重遷移しない | T14、T15 |
| A08 | 機密値がすべての出力経路に残らない | T04、T14、T17 |
| A09 | Assertion失敗、未検証の操作完了、Test成功を区別 | T12、T13、T17 |
| A10 | 保存後の通信切断で保存が再送されない | T12、T13 |
| A11 | 実行中のModel変更が判定基準を変えない | T03、T13 |
| A12 | 生成TestがCLIと同じ許可・判定を適用 | T17 |
| A13 | 再開前の画面変更を検出し、不適切な再開を拒否 | T13 |
| A14 | 導入・更新で既存のユーザーファイルを保持 | T19 |

## 4. 実装の進め方

最初はT01〜T04を完了し、契約Fixtureを以後の共通基準にする。T05〜T09で操作しないCaptureの縦断経路を完成させる。その後T10〜T13で安全なAssist/Test、T14〜T17で記録・生成を追加する。最後に実装済みCLIへSkill・Adapterを接続する。

各タスクは実装、必要な検証、利用者向け説明を含めて完了とする。仕様の変更が必要になった場合は詳細設計・Schema・契約Fixture・関連タスクを同時に更新する。所要時間は依存版とBrowser Adapterの実証前には確定せず、T05完了時に見積もりを見直す。
