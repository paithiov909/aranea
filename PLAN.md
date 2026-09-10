# 現在の実装状況：M0〜M7

以下の M0〜M4 の当初計画は履歴です。現在は基本 REPL と NODEFS に加えて、次を実装しています。

| 段階 | 内容 | 完了条件 |
|---|---|---|
| M5 | 引数なし、ファイル、単一 `-e`、help/version/`--`。非対話評価とホストファイル読み込み | 実 WebR と子プロセスで計算、パス、読み書き、エラー停止を検証 |
| M6 | 行単位ストリーム、末尾出力、`.Last()`、q の終了コード、シグナル、入力待ち防止 | タイムアウト付きテストで正常・異常終了とストリームを検証 |
| M7 | files/prepack、private 維持、ローカル tarball から npx 起動 | `npm run test:package` で production install と3形式を検証 |

公開・リリース・remote push は実施しません。スクリプト引数、複数 `-e`、commandArgs 互換、stdin 転送は後続です。通常の必須チェックは build/typecheck/test、配布チェックは test:package とします。Codespaces 実端末での Ctrl+C、貼り付け、IME、カーソル表示は手動確認を残します。

---

# aranea：最小 CLI の調査結果と実装計画

## 1. 現状と採用方針

**Node.js 標準の `node:readline` と、WebR の `writeConsole()`／`stream()` を組み合わせる構成を推奨します。** R の構文判定と評価は WebR 内の REPL に任せます。

リポジトリには [AGENTS.md](/workspaces/aranea/AGENTS.md)、LICENSE、.gitignore のみがあり、package.json・ソース・テストはありません。AGENTS.md は未追跡です。調査前後で状態は変わっておらず、コード変更・依存インストール・R の実行は行っていません。現在の環境は Node.js 24.20.0、npm 11.19.0 です。

AGENTS.md の TypeScript／ESM、Node.js 20 以上、WebR の完全固定、小さなアダプター、システム R 不使用という方針を採用します。追加確認で決まった内容は次のとおりです。

- WebR の推移依存に限り、配布済み native バイナリを許容する。aranea 独自の native addon とローカルコンパイルは禁止。
- NODEFS は基本 REPL 完了後の独立したマイルストーンとする。
- フルスクリーン TUI、補完、プロット表示、パッケージ永続化は対象外。

「npm install と npm run build だけで起動できる」は、**この２コマンドで準備が完了し、`npm start` または `node dist/cli.js` で起動できる**という意味で扱います。build 自体は REPL を起動しません。

## 2. 確認できた WebR API と方式比較

調査時の npm 公開版は **`webr@0.6.0`** でした。一方、公式ドキュメントの `latest` は **0.6.1 開発版**を表示しています。このため npm の公開 tarball に含まれる package.json、型定義、配布 JavaScript と source map を照合しました。以下の実装上の判断は公開版を基準にします。[npm 公開パッケージ](https://www.npmjs.com/package/webr)、[公式ドキュメント](https://docs.r-wasm.org/webr/latest/communication.html)

| 項目 | 公開版で確認した内容 |
|---|---|
| ESM | `import { WebR, Console, ChannelType } from 'webr'` に対応する exports と型定義がある |
| 初期化 | `new WebR(options)`、`await webR.init()`。型定義上、`init()` は `Promise<unknown>` |
| 対話モード | `WebROptions.interactive` があり、既定値は `true` |
| 入力 | `writeConsole(input: string): void`。実装が末尾に `\n` を付加するため、呼び出し側は改行を付けない |
| 出力 | `stream(): AsyncGenerator<Message, void>`。`stdout`、`stderr`、`prompt` などを受け取る |
| ストリーム終了 | `stream()` は `closed` を受け取ると終了し、呼び出し側へそのメッセージを yield しない |
| 中断 | `interrupt(): void`。SharedArrayBuffer 版では入力キューもリセットする |
| 終了 | `close(): void`。worker の終了を開始するが、終了完了を await する API ではない |
| FS | `FS.mkdir()`、`FS.mount('NODEFS', { root }, mountpoint)` が型定義に存在する |
| 配布物 | worker、`R.wasm`、R 用 VFS データが npm tarball に同梱される |

API の概要は公式の [WebR クラス](https://docs.r-wasm.org/webr/latest/api/js/classes/WebR.WebR.html)とも照合済みです。ただし、同梱ファイルだけで通常起動が完結することは、実行による確認が残っています。

| 比較軸 | WebR `Console` | `writeConsole()`／`stream()` |
|---|---|---|
| 最短の試作 | stdout・stderr・prompt の callback を渡すだけで短い | メッセージの振り分けが必要 |
| Node 対応 | Node 分岐はある。ただし既定 prompt はブラウザーの `prompt()` を使うため置換必須 | Node の端末制御をそのまま接続できる |
| 終了・例外管理 | `run(): void` が内部の非同期ループを開始し、その完了を外から await できない | 自分が所有する非同期タスクとして完了・例外を扱える |
| 不要な処理 | 構築時に canvas 用 graphics device を設定する | graphics の初期設定を追加せずに済む |
| 拡張 | callback にないメッセージは扱いづらい | 未対応メッセージの処理方針を明示できる |

`Console` は短いデモに向いていますが、aranea では中断と終了を明確に管理したいため、直接扱う案を採用します。`Console.run()` と独自の `stream()` を同時に動かすと出力の取り合いになるため、消費者は一つにします。[Console API](https://docs.r-wasm.org/webr/latest/api/js/classes/WebR.Console.html)

なお、`webr@0.6.0` はブラウザー UI 関連の依存も含み、`lightningcss` が推移依存として導入されます。今回合意した例外を文書化し、クリーンインストール時にコンパイル不要であることを確認します。

## 3. 最小構成と振る舞い

構成は三つに分けます。

- **CLI**：起動、エラー表示、終了コードを管理する。
- **端末制御**：`node:readline` で行入力、プロンプト表示、Ctrl+C、EOF を扱う。
- **WebR アダプター**：初期化、行送信、出力イベント、中断、終了を担当する。WebR の型やメッセージを端末層へ漏らさない。

内部インターフェースは、`start()`、`sendLine(line)`、`interrupt()`、`close()` と、stdout・stderr・prompt・終了・エラーの通知に限定します。公開ライブラリー API は作らず、CLI の `bin` 名を `aranea` とします。

実装方針は以下で固定します。

- TypeScript を `tsc` で ESM に変換し、バンドラーは使わない。実行依存は直接には `webr: "0.6.0"` のみ。
- 通信は `ChannelType.SharedArrayBuffer` を指定する。PostMessage は中断できないため自動フォールバックしない。[公式の通信方式比較](https://docs.r-wasm.org/webr/latest/communication.html)
- 入力行は空行を含めてそのまま送る。`evalR()` による一行評価や独自の括弧カウントは使わない。
- `prompt` の文字列をそのまま表示する。`>` や `+` の文字だけで入力の種類を判定しない。
- 貼り付け等の先行入力は端末側で保持し、WebR の入力要求ごとに一行送る。中断・終了時には未送信分を破棄する。
- Ctrl+C は入力の取り消し／R の中断とし、通常の終了操作にはしない。
- EOF／Ctrl+D は保存なしで閉じる。`q()` は R に渡し、WebR 側の終了に追従する。起動引数には `--no-save`、`--no-restore` を用いる。
- 終了処理は複数経路から呼ばれても一度だけ実行する。readline、シグナルハンドラー、WebR を片付ける。
- 最初の公開 CLI は対話端末を対象とし、非 TTY 入力は説明付きで拒否する。バッチ実行は追加しない。

`node:readline` は行入力と SIGINT・EOF を扱えますが、その Interface が開いたままだと Node が終了しないため、後始末を明示します。[Node.js readline](https://nodejs.org/api/readline.html)

## 4. 実証が必要な点

**今回は API・実装の静的確認までです。以下は動作確認済みとは扱いません。**

| 対象 | 実証する内容・テスト例 | 合格基準 |
|---|---|---|
| 基本出力 | `1+1`、代入後の参照、`stop("x")`、`cat("x")` | 自動表示・状態保持・エラー後の復帰が成立し、改行や prompt が重複しない |
| 複数行入力 | 関数定義、未完の括弧・文字列、空行、複数行貼り付け | 継続 prompt が表示され、完成した式が一度だけ評価される |
| R の `readline()` | `x <- readline("name: "); x`、空文字の回答 | 独自 prompt が出て、回答が R コードとして別評価されない |
| Ctrl+C | 長時間ループ、継続入力中、`readline()` 待ち、通常 prompt で操作 | プロセスを落とさず操作可能な prompt に戻る。次の式を評価できる |
| 中断の競合 | 入力送信直後、連続 Ctrl+C、貼り付け途中 | 古い入力が中断後に実行されず、prompt が二重化しない |
| 終了 | `q()`、`q(save="no")`、EOF、SIGTERM、初期化失敗 | worker が残らず、端末設定が戻り、子プロセスが期限内に終了する |
| 終了の意味 | `q()` と `close()` の比較、`.Last` の扱い | R の通常終了と worker 強制終了の差を記録する。EOF に R の終了フック実行を約束しない |
| NODEFS | 一時ディレクトリを mount し、`source()`、CSV 読み書き、空白・日本語パス、権限エラー | ホストと R の双方から結果を確認でき、失敗が REPL を壊さない |

NODEFS 自体は公式に Node.js 対応が明記されています。ただしホストの cwd と R の cwd は別なので、後続実装ではホストの起動ディレクトリを `/workspace` に mount してから R の cwd を設定します。ホストファイルへの書き込みは実ファイルに反映されることを README に記載します。[公式 NODEFS 手順](https://docs.r-wasm.org/webr/latest/mounting.html)

## 5. マイルストーンと完了条件

| 段階 | 内容 | 完了条件・テスト方法 |
|---|---|---|
| **M0：導入と起動確認** | package.json、lockfile、TypeScript、検証コマンドを用意。WebR の初期化と終了だけを確認 | 新しい環境で `npm install` と build が成功。システム R・ローカルコンパイルなしで WebR を初期化・終了できる。インストール後のネットワーク遮断でも基本起動を確認 |
| **M1：最小 REPL** | アダプター、標準端末入力、stdout／stderr／prompt、EOF 終了を実装 | `1+1`、変数保持、空行、R エラーからの復帰が通る。`npm start` と `node dist/cli.js` の両方で起動できる |
| **M2：対話入力の検証** | 複数行、R の `readline()`、貼り付けキューを検証・修正 | 上表の複数行・readline ケースを実 WebR の統合テストで確認。Codespaces 端末で表示と入力順を手動確認 |
| **M3：中断と終了の安定化** | Ctrl+C、SIGTERM、`q()`、初期化失敗、二重終了を処理 | タイムアウト付き子プロセステストで終了を確認。中断後に再評価できる。Codespaces で Ctrl+C／Ctrl+D と端末復元を手動確認 |
| **M4：NODEFS** | ホスト cwd の mount と R cwd の設定を追加 | 一時ディレクトリで `source()` と読み書きが成功。mount 失敗時は説明付きで終了し、別の cwd で黙って続行しない |

**最初の実用的な CLI の完了地点は M3** とし、M4 は別変更にします。

各コード変更後に `npm run build`、`npm run typecheck`、`npm test` を実行します。テストは Node 標準の test runner を用い、端末状態のテストと実 WebR の統合テストを分けます。Node.js 20・22・24 と Codespaces の実環境を確認対象にし、native addon を必要とする PTY ライブラリーは追加しません。

パイプ経由の子プロセステストだけでは実際のキー操作や端末描画を保証できません。各マイルストーンの報告では、自動検証の結果と、残る手動確認を分けて記載します。
