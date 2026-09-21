# FlowUI Skills 詳細設計 v0.1

状態: 実装着手用の設計案。ユーザーとの合意事項を要件とし、それ以外は本書で採用する初期設計とする。

## 1. 目的と範囲

実ブラウザから得られる観測事実を基にUI Modelを蓄積し、同じ逐次ScenarioをAssistとTestで利用する。対象アプリケーションのソースコードを要求しない。

MVPは単一ユーザー・ローカル環境・単一アクティブTabの運用を対象とする。通常のページ遷移、同一URLの画面変化、フォーム、Table、Menu、Dialog、Tab、Accordionを扱う。Source Enricher、並列Test、クラウド実行、自動Recovery、複雑な分岐・ループは対象外とする。新規Tabへの自動切替、iframe内部、閉じたShadow DOM、仮想化Tableの全件走査は初期版では非対応として明示的に停止または部分観測を返す。

初期実装はTypeScriptによるCLIと共有ライブラリを想定する。ブラウザ実装はPlaywright互換アダプターの背後に分離する。ライブラリの版・具体的な接続APIは実装開始時に現行ドキュメントで確認し固定する。

## 2. 確定する実行契約

1. Test開始時にModel・Scenarioのスナップショットとハッシュを固定する。実行中のCaptureは別の候補ファイルへ保存し、実行中の判定基準を変更しない。
2. 操作を `read-only / mutation / destructive / unknown` に分類する。未知の操作は実行しない。Captureの操作は確認済みread-onlyに限定する。
3. 機密値は永続化・ログ・Agent出力の前に保護する。生イベントは既定で保存せず、一時キューにも機密値を保持しない。
4. Browser SessionをCLIプロセスと独立して維持する。Assistの停止・終了ではブラウザを閉じない。
5. Targetは一意一致でのみ実行する。位置指定への暗黙フォールバックは禁止する。
6. RecordはScenario候補を生成する。観測結果だけから正しい期待結果を確定しない。Assertionがない実行は `completed` であり `passed` ではない。
7. Recoveryは手動選択とする。状態を変更する操作を自動再試行しない。

## 3. コンポーネントと責務

| コンポーネント | 責務 | 担当しない処理 |
|---|---|---|
| Skills | 意図解釈、Scenario設計、安全分類の根拠整理、曖昧性解消 | Locator生成、Schemaの手動検証 |
| CLI | 入出力、コマンド振り分け、終了コード | 自然言語の意味判断 |
| Session Service | ブラウザ所有、Tab登録、操作ロック、Record購読 | 業務上の期待結果の決定 |
| Browser Adapter | 観測、要素解決、操作、イベント購読 | Model更新の承認 |
| Observation Pipeline | 正規化、秘匿化、上限適用、証跡付与 | 未観測の振る舞い推定 |
| Knowledge Store | Model・ページ台帳・候補の保存、差分、版管理 | 実行中の期待結果の置換 |
| Resolver | page/target/rowを一意に特定 | 先頭候補の採用 |
| Safety Gate | 操作分類と許可範囲の照合 | 暗黙の権限拡大 |
| Scenario Engine | 逐次実行、停止、Assertion、結果保存 | 自動Recovery |
| Renderer | Scenarioから共通Engineを呼ぶTestコードを生成 | Assertionの発明 |

依存方向は `CLI → 各サービス → 契約・Browser Adapter` とする。Browser AdapterはSkillや利用Agentに依存しない。RendererとCLI実行は同一のResolver・Safety Gate・Assertion実装を使用する。

## 4. リポジトリと保存先

```text
skills/{ui-explorer,ui-observer,ui-model-generator,scenario-builder,
        playwright-operator,ui-test-generator,ui-automation-workflow}/SKILL.md
packages/cli/src/{commands,session,browser,observation,knowledge,
                  resolver,safety,record,scenario,render,shared}/
schemas/{ui-model,scenario,observation,recorded-action,result,policy}.schema.json
templates/
adapters/{claude-code,codex}/
docs/{detailed-design,implementation-tasks}.md
tests/{unit,contract,integration,e2e,fixtures}/
```

利用先には次を作成する。srcディレクトリの存在は確認条件にしない。

```text
.flowui/
  config.yaml
  policy.yaml
  pages.yaml
  ui-model/<page-id>.yaml
  scenarios/<scenario-id>.yaml
  analysis/captures/<capture-id>.json
  analysis/candidates/<candidate-id>.yaml
  results/<run-id>/{result.json,scenario.yaml,models/,evidence/}
```

Session接続情報と一時的な許可情報はOSのユーザー専用ランタイム領域に保存し、プロジェクトやGitへ保存しない。結果・Capture・候補は初期テンプレートでGit除外対象とする。Model・Scenarioも秘匿化済みデータのみ保存する。

保存は同一ディレクトリ内の一時ファイルから原子的に置換する。更新は期待する旧ハッシュを指定し、不一致なら競合として停止する。IDにパス区切りや親ディレクトリ参照を許可しない。

## 5. データ契約

全成果物に `schema_version` を付ける。破壊的変更はmajorを上げ、未知のmajorは読み込まない。Schemaは構造検証を担い、参照整合性・ID重複・循環・許可との整合性は追加の意味検証で確認する。以下の型とKeyをSchema実装の基準とする。

### 5.1 Observation

必須項目は `id, captured_at, session_id, tab_id, document_id, url, landmarks, elements, completeness, redactions`。URLは機密パラメータを除去する。`document_id` はページ文書の切替を検出する内部IDでありPage Identityとは別物とする。

各要素はローカルな観測ID、role、accessible name、label、可視性、enabled状態、必要最小限の属性、Locator候補を持つ。値は既定で収集しない。機密要素は値の有無も必要な場合のみ返す。Heading、Form、Table、状態変化の根拠を含め、内部のReact state等は取得しない。

既定の出力上限は要素200件、Tableプレビュー20行、テキスト1項目200文字、JSON全体128 KiBとする。切り詰めは `completeness: partial` と理由・省略数で示す。切り詰めた情報を「存在しない」根拠にはしない。Target解決時は対象を絞った再観測を行う。

### 5.2 UI Model

| Key | 内容 |
|---|---|
| `page` | `id, name, identity` |
| `revision` | 保存内容のハッシュ |
| `evidence` | 観測ID、日時、秘匿化済み証跡への参照 |
| `elements` | 論理IDをKeyとするrole/name/label/Locator候補/既知属性 |
| `forms` | fieldの論理ID、観測できた制約とValidation |
| `tables` | 列ID、列名、行識別候補、部分観測情報 |
| `states` | 名前付きの可視性・属性・テキスト等の述語 |
| `actions` | 操作、Target、分類、根拠、前提状態 |
| `transitions` | 実際に観測した操作前後のpage/stateと証跡 |

知識は `observed` または `unknown` とする。推測は説明付き候補として別保存し、実行可能Modelの観測事実に混ぜない。過去の観測と実行時の現在状態を区別する。論理IDは初回採番後に維持し、表示名変更だけで自動再採番しない。対応が曖昧なら候補として扱う。

Page IdentityはURLだけで成立させない。初期版はスコアリングを使わず、URL条件があればその条件と、1件以上の必須landmarkのすべてが成立したときに一致とする。0ページ一致はunknown、複数ページ一致はambiguousとして停止する。同一URLのページはlandmarkで区別する。任意項目の不足は一致根拠に使わない。

Dialog等の重ね合わせは既知Page上のStateとして表現できる。未定義の主要Dialog、前提State不一致、Page識別不能は実行停止条件とし、無関係な表示変更まで全面一致で要求しない。

### 5.3 Scenario

```yaml
schema_version: '1.0'
id: edit-user
status: ready
intent: ユーザー名を更新し、完了表示を確認する
start_page: user-edit
inputs:
  display_name:
    type: string
    sensitive: false
steps:
  - id: enter-name
    page: user-edit
    action: fill
    target: displayName
    value: { input: display_name }
  - id: save
    page: user-edit
    action: click
    target: saveButton
  - id: verify-saved
    page: user-edit
    assert:
      type: text
      target: saveStatus
      equals: 保存しました
    expectation:
      source: user-intent
      reference: 更新後に完了表示が出ることを確認する
```

`status` は `draft / ready`。各Stepはactionまたはassertのどちらか一方を持つ。Step IDは安定かつ一意とする。入力値はliteral、input参照、secret参照のいずれかとし、自由なJavaScriptや式評価を認めない。機密値はsecret参照のみ許可する。

MVP Actionは `click, fill, select, check, uncheck, press, navigate`。任意コード実行は含めない。`press` は許可されたキーに限定し、Enter等による送信も対象Actionの安全分類を必要とする。navigateは明示されたURLと許可originのみ扱い、URLだからread-onlyとは推定しない。

MVP Assertionは `visible, hidden, enabled, disabled, text, value, url, page, state, row-count`。比較は型ごとに定義された完全一致を基本とする。機密値を比較する場合も出力には実値を含めない。`hidden` は0件または一意に解決した非表示要素で成立し、複数件はambiguousとする。対象の不存在を含むAssertionは観測の切り詰めを根拠に判定しない。

readyは構造・参照検証済みを意味する。Testでpassedとなるには、意図に裏付けられたAssertionが1件以上あり、全Stepが成功している必要がある。draftはTest不可。Assistは検証済みの操作Stepを利用可能とする。

### 5.4 Table Target

```yaml
target:
  table: userTable
  row:
    match:
      email: tester@example.test
      department: QA
  element: editButton
```

`match` は指定列のAND完全一致とする。Table自体、行、行内要素の各段階で一意性を確認する。複数一致なら追加条件を求める。`index` は明示指定のみ、0始まりとし、並び順の前提と直前の行表示値を検証する。ページング・仮想化で全体を見られない場合は対象範囲を返し、見えていない行を不存在と断定しない。

### 5.5 Result

必須項目は `run_id, mode, status, started_at, scenario_hash, model_hashes, steps, redactions`。各Stepに開始・終了時刻、状態、秘匿化した実行対象、証跡参照、機械可読reason codeを保存する。

| status | 意味 |
|---|---|
| `passed` | Testの全Stepと1件以上のAssertionが成功 |
| `completed` | 操作列が完了。テスト成功を意味しない |
| `failed` | 明示された期待結果が不成立 |
| `blocked` | 未知状態、曖昧Target、許可不足などで続行不可 |
| `paused` | 指定Step直前の正常な停止 |
| `error` | 接続障害、内部エラー等で実行結果を確定できない |
| `cancelled` | ユーザーによる中断 |

reason codeの例: `UNKNOWN_PAGE, AMBIGUOUS_PAGE, UNKNOWN_STATE, TARGET_NOT_FOUND, TARGET_AMBIGUOUS, PERMISSION_REQUIRED, SESSION_LOST, ACTION_OUTCOME_UNKNOWN, ASSERTION_FAILED, UNSUPPORTED_SURFACE`。

## 6. Browser Sessionと排他制御

Session Serviceが可視ブラウザを起動・所有し、ローカルのユーザー専用IPCを公開する。接続情報は権限を制限し、認証用トークンをログへ出さない。MVPはFlowUIが起動したブラウザを対象とし、任意の既存ブラウザへのattachは拡張扱いとする。

Sessionは `session_id, tabs, active_tab_id, owner, state` を持つ。状態は `idle / recording / executing / paused / disconnected`。Tab単位の操作ロックを設け、Recordと自動実行、複数の実行を競合させない。Test中のユーザー操作を検知した場合は状態を再確認してblockedとする。操作直前の再検証で競合を減らすが、外部アプリ全体の原子性は保証しない。

ブラウザ終了はsession closeだけが行う。切断後は自動再送しない。操作送信後に応答を失った場合は `ACTION_OUTCOME_UNKNOWN` を返し、実行済みか不明であることを記録する。再開時は対象Tab・Page・State・入力状態・許可を再検証し、ユーザーが選んだStepから実行する。機密入力を復元するための平文スナップショットは作らない。

## 7. Safetyと機密情報

Action分類はModel上の確認済み定義と、その時点の操作内容を照合する。fill/check等も自動保存し得るため、ローカル入力という理由だけでread-onlyにしない。分類根拠がなければunknownとする。認識の不確実性とユーザーの許可は別であり、許可を与えても未知の効果が既知になるわけではない。

許可は `environment, origins, scenario_hash, action_ids, target_scope, input_constraints, expires_at` を持ち、保存された秘密値は含めない。利用者が実行前に範囲を確認して発行する。destructiveは個別Actionと対象を限定する。期限切れ・Model上の操作定義変更・Scenario変更・対象変更では再確認する。Modelハッシュも許可に結び付ける。既に有効な許可は再利用できる。

Gateは全操作の直前に実行する。生成Testも共通Engineを通し、実行時に許可を与える。許可や機密値は生成コードへ埋め込まない。CIでも同じ範囲指定を要求する。

秘匿化はBrowser側の取得境界と保存・出力境界の両方で行う。password属性、設定されたlabel/selector、URLパラメータ名等を用いる。未知の機密情報を完全自動検出できるとは保証せず、初期設定で対象プロジェクトの機密ルールを確認する。例外・デバッグログも共通の秘匿化を通す。出力上限を適用する前に秘匿化する。

ブラウザ内の文言はデータとして扱い、Agentへの命令として扱わない。ページに書かれた指示で許可の発行・送信先追加・ローカルファイル読取を行わない。

## 8. Mode別フロー

### Capture

Session確認 → 非操作観測 → 秘匿化・圧縮 → Page識別 → 新規Model候補または既存Modelとの差分を保存。操作による追加観測は別途明示された確認済みread-only Actionだけに限定する。観測事実と操作効果を区別する。既存Modelへの反映は差分を確認してacceptし、Test実行中のスナップショットには影響させない。

### Record

既知Model読込 → イベント購読開始 → 取得時秘匿化 → 順序付きイベントを一時キューへ → 正規化 → Scenario候補保存。未知ページではユーザー操作を代行せず非操作Captureを行う。Capture待ちのイベントは文書IDと連番で保持する。未解決Targetは候補内で未解決とし、readyへ進めない。

重複イベントIDは除去する。同じ文書・同じTargetの連続inputは最終値に統合するが、click・blur・submit・遷移をまたいで統合しない。連続clickは別操作の可能性があるため一律に除去しない。遷移は操作の結果として記録し、replayでclickとnavigateを二重実行しない。キュー上限超過や購読切断は記録欠落を明示して停止する。

### Assist

Scenario検証 → Session・入力・許可確認 → Stepごとの観測・Target解決・Gate・実行 → 結果観測。`--pause-before <step-id>` に到達したら操作前にpausedとし、Sessionを保持する。存在しないStep指定は実行前にエラーとする。明示されたAssertionはAssistでも評価する。

### Test

Scenario・Modelを固定保存 → 全参照・入力・許可の事前検証 → Stepを逐次実行 → Assertion → 結果保存。実行直前にもGateと状態を再確認する。未知状態は非操作Captureの候補を保存してblocked、不一致はfailedとする。対象が特定できない状態で次Stepへ進まない。

Assertionと観測待ちは期限内のread-only再観測を許可する。既定タイムアウトは10秒、Step単位で指定可能とし、Scenarioで固定・結果に記録する。操作の再送とは区別する。タイムアウト後は条件の不成立と接続不能を区別する。

## 9. CLI契約

以下は設計上のInterfaceであり、現時点で実装済みではない。

| コマンド | 主な引数・結果 |
|---|---|
| `flowui init` | `.flowui`初期化。既存ファイルを上書きしない |
| `flowui adapter setup <codex|claude-code>` | canonical Skillsを参照する導入ファイルを作成 |
| `flowui update` | 導入済みテンプレート・adapterの差分表示。変更済みファイルは自動上書きしない |
| `flowui session start/status/close` | Session作成・状態確認・明示終了 |
| `flowui inspect --session <id> --tab <id>` | 上限付きObservation |
| `flowui inspect table <id>` | `--limit --columns --where --matching-only --metadata-only`。条件は構造化比較のみ |
| `flowui capture --page-id <id>` | Model候補・証跡・差分を保存 |
| `flowui capture accept <candidate-id>` | 元Modelハッシュ照合後に登録・更新 |
| `flowui record start/stop/status` | Record制御と候補保存 |
| `flowui normalize-record <file>` | 秘匿化済みイベントから正規化操作を生成 |
| `flowui validate <model|scenario> <file>` | 構造・意味検証。Scenarioは参照Modelも確認 |
| `flowui resolve-target <scenario> --step <id>` | 候補数・根拠・解決結果。操作は行わない |
| `flowui derive-value --model <file> --field <id> --variant <name>` | 観測済みのmin/max/length/stepから境界値候補。業務値は生成しない |
| `flowui diff <model|scenario> <before> <after>` | IDベースの意味差分。Observation入力は先に候補Modelへ正規化 |
| `flowui permit <scenario>` | 環境・対象・Action・期限を提示し、ユーザー指定範囲の許可を発行 |
| `flowui run <scenario> --mode <assist|test>` | `--session --tab --input-file --permit --pause-before` |
| `flowui resume <run-id> --from-step <id>` | 前提再検証後に新しい実行記録を作成。元実行への参照を残す |
| `flowui render playwright <scenario> --output <file>` | 共通Engineを使用するTestファイルと必要な設定情報 |

Session/Tabは設定で一意に決まる場合だけ省略可能とする。複数候補から直近Tabを暗黙選択しない。secretは実行環境から解決し、コマンド引数に平文を要求しない。

標準出力は `{schema_version, status, data, warnings, error}` のJSON、診断は標準エラーとする。終了コードは `0=正常完了/paused、1=Assertion失敗、2=入力・Schemaエラー、3=blocked、4=接続・内部エラー、130=中断`。pausedとcompletedとpassedはJSONで区別する。

## 10. SkillとAdapter

7つのSkillはそれぞれ日本語の概要、英語のPurpose・Procedure・Rulesを必須とする。詳細はreferencesへ分離し、CLIで処理できる検証や差分をAgentに再実装させない。

| Skill | 主な責務 |
|---|---|
| ui-explorer | 観測範囲と安全な探索順序の選択 |
| ui-observer | inspectを使用し、観測不足を特定 |
| ui-model-generator | 候補の意味確認、ID対応、差分の採否 |
| scenario-builder | 自然言語・Recordから操作と期待結果を設計 |
| playwright-operator | run/resolve-target等を使用した操作代行 |
| ui-test-generator | 確定Scenarioの選定、Fixture統合、render |
| ui-automation-workflow | Modeの選択、停止・再開、成果物の受け渡し |

Adapterは各Agentの導入形式だけを扱う。同じ安全規則やScenario設計規則を複製しない。Skill本文を各Agentへ導入する場合はcanonical版から生成し、差分検査できるようにする。

## 11. 受け入れ条件

- ソースコードなしでCapture → Record → Assist → Testが完了する。
- 同一URLの異なる画面をlandmarkで区別し、曖昧なら停止する。
- Assistが保存Step直前で停止し、手動でそのまま保存できる。
- 未知画面で候補だけが保存され、既存Model・実行中の期待結果が変化しない。
- 権限不足・unknown操作・Target複数一致ではブラウザ操作が発生しない。
- Recordの遷移後も順序が維持され、入力統合で操作境界が失われない。
- 認証情報がRecord、Model、Scenario、Result、ログ、生成Testに残らない。
- Assertionなしではpassedを返さず、生成Testでも同じ結果になる。
- 保存操作後の切断で保存を自動再送しない。
- Tableの並び替え・重複値・部分観測を誤った行操作につなげない。

## 12. 実装時の確認事項

ブラウザ互換範囲、ランタイムと依存ライブラリの版、各Agentのadapter導入形式は実装開始時に公式資料で確認する。対象アプリごとの機密ルール・環境・操作許可は利用時の必須設定であり、FlowUIが推測して補完しない。実装タスクと検証条件は `implementation-tasks.md` に定義する。
