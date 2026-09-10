# aranea

Node.js 上で WebR を動かす、小さな R コンソール・スクリプト実行 CLI です。GitHub Codespaces の通常のターミナルを主な対象とします。

## 起動

Node.js 20 以上と npm が必要です。システムの R、Rscript、コンパイラーは不要です。

```sh
npm install
npm run build
npm start
```

ビルド後は `node dist/cli.js` でも起動できます。CLI の bin 名は `aranea` です。build は TypeScript の変換のみを行います。引数なしの場合は標準入力・標準出力が TTY のときに REPL を起動し、パイプ入力は拒否します。

```r
1 + 1
f <- function(x) {
  x + 1
}
f(41)
name <- readline("name: ")
```

入力の構文判定は R に任せ、R が要求する行ごとに送信します。貼り付けた複数行も順番に処理します。Ctrl+C は入力・計算を中断し、未送信の貼り付け入力を捨てます。

`q()` は保存なしで R を通常終了し、`.Last()` を実行します。`q(save="no", status=7)` のような終了コードも Node に伝えます。空の入力行で Ctrl+D を押すと保存なしで worker を閉じます。この場合や SIGTERM では `.Last()` の実行を保証しません。セッションは起動時に復元しません。

## 現在の範囲

M0〜M7（基本 REPL、NODEFS、非対話実行、終了処理、ローカル配布検証）を実装しています。

- 起動時のホスト作業ディレクトリを NODEFS で `/workspace` にマウントし、R の作業ディレクトリに設定します。設定に失敗した場合は対象パスと理由を表示して終了します。
- フルスクリーン TUI、補完、プロット表示、パッケージ・履歴の永続化は対象外です。
- stdout/stderr は行単位です。改行なしの `cat()` は次の入力要求時にフラッシュして一行として表示します。バイト単位の端末出力再現はしません。
- 多行貼り付け時は先行して入力がエコーされ、後から継続プロンプトが並ぶ場合があります。実行順は維持します。
- pager、viewer、canvas 等の未対応メッセージには通知を表示します。

## 非対話実行

```sh
node dist/cli.js script.R
node dist/cli.js -e "print('hello!')"
node dist/cli.js -- -script.R
node dist/cli.js --help
node dist/cli.js --version
```

ファイルまたは単一の `-e` を指定すると、TTY 不要の非対話モードで実行します。バナー・REPL の入力プロンプト・コードのエコーは出しません。可視の式の結果は自動表示し、代入結果は表示しません。`interactive()` は `FALSE` です。stdout/stderr は実行中に行単位で転送し、末尾の改行なし出力も終了時にフラッシュします。

ファイルは UTF-8 で読み込みます。相対・絶対パス、空白・日本語、先頭の shebang に対応します。ホスト側で読み込んだ内容を WebR 内の一時ファイルとして実行するため、R の診断に `/tmp/aranea-script.R` が出る場合があります。R の作業ディレクトリはスクリプトの所在によらず、ホストの起動ディレクトリに対応する `/workspace` です。

正常終了は `0`、引数・読み込み・初期化・構文・未捕捉の実行エラーは `1` です。実行エラー後の処理は続けません。通常完了と明示的な `q()` は保存なしで終了し、`.Last()` を実行します。`q(save="no", status=7)` の終了コードも引き継ぎます。SIGINT は `130`、SIGTERM は `143` で worker を閉じ、この場合の `.Last()` は保証しません。初期化のタイムアウトは30秒で、コードの実行時間には制限がありません。

Rscript の完全互換ではありません。スクリプト引数、`commandArgs()` の互換、複数 `-e`、標準入力からのコード・データ入力は未対応です。ホスト stdin は転送せず、WebR の非対話動作に従って `readLines(stdin())` は EOF、`readline()` は指定した文字列を表示して空文字を返します。それ以外でコンソール入力待ちが発生する場合は説明付きで終了します。

## ローカル配布と npx

まだ npm には公開していません。公開レジストリからの `npx aranea` はこのリポジトリの成果物を指すとは限りません。ローカル tarball を使って導入・呼び出しを確認できます。

```sh
# リポジトリで実行。prepack がビルドします。
npm pack

# 別ディレクトリのプロジェクトで実行。実際の tarball の絶対パスを指定します。
npm install --omit=dev /absolute/path/aranea-0.1.0.tgz
npx --no-install aranea
npx --no-install aranea script.R
npx --no-install aranea -e "print('hello!')"
```

配布物には `dist`、README、LICENSE、npm が必須とする package.json を含めます。実行時には aranea のソースや TypeScript は不要です。`private: true` は維持し、公開作業は別途行います。

`npm run test:package` はリポジトリ外の一時ディレクトリに tarball をインストールし、上記3形式を検証します。依存インストールにネットワークを使用する場合があります。Linux の REPL 確認には Python 3 を使います。

## ホストファイルの操作

CLI を起動したディレクトリ内のファイルは、R から相対パスで操作できます。たとえば、ホスト側に `script.R` と `input.csv` を用意して起動します。

```r
getwd() # "/workspace"
source("script.R")
data <- read.csv("input.csv")
write.csv(data, "output.csv", row.names = FALSE)
```

`output.csv` はホストの起動ディレクトリに作成されます。`/workspace` 内での書き込み・上書き・削除はホストの実ファイルに直接反映され、CLI 終了後も残ります。空白や日本語を含むファイル名も使用できます。

## 構成と WebR 0.6.0 への対応

`src/args.ts` は引数解析、`src/batch.ts` は非対話実行のライフサイクル、`src/cli.ts` は起動、`src/terminal.ts` は readline と入力キュー、`src/webr.ts` は WebR API を扱います。WebR は完全固定し、SharedArrayBuffer チャネルを使用します。出力の消費者はアダプター内の `stream()` 一つです。入力は `writeConsole()` が改行を付加するため、追加の改行を付けません。

公開パッケージの型定義、source map、R.js を確認した上で、アダプターに次のバージョン依存の補助処理を入れています。依存ファイル自体は変更しません。

1. worker 内の `Module.webr.setPrompt` で TTY バッファをフラッシュします。
2. 入力待ちの中断は worker の `channel.read` に専用メッセージを送り、`Module._Rf_onintr()` を呼びます。標準 `interrupt()` の入力キュー reset が未完了の読み取りを取り残す競合を避けます。計算中は標準 `interrupt()` を使います。中断からの復帰時には無害な同期メッセージを送り、遅れて到着する古い入力要求が次の R コマンドを消費することを防ぎます。
3. R.js の終了処理が設定する worker の `process.exitCode` を、worker のイベントループが戻った時点で検出し、ストリームを閉じます。R の `q()` や `.Last` は置き換えません。

非対話の `q()` は評価 API に `ExitStatus` を返した後も同期ディスパッチャー内に留まるため、追加の RPC でバッファをフラッシュし、同じ終了通知を送信します。非対話時の入力要求は worker の `readConsole` で検知します。

これらは安定した公開 WebR API ではありません。WebR を更新するときは削除可能か再調査し、実 WebR・疑似端末の回帰テストを実行してください。

直接の実行依存は `webr: "0.6.0"` と `ws` です。WebR の `WebSocketMap` は Node.js 20 では別途インストールした `ws` を必要とするため、当初の WebR のみという案から追加しました。`ws` は JavaScript 実装です。ただし WebR はブラウザー UI 向け依存も配布しており、lightningcss 等の配布済み native バイナリを推移依存として含みます。プロジェクト方針の合意済み例外としてこれを許容します。aranea 独自の native addon やローカルコンパイルは追加しません。npm の初回インストールにはネットワークが必要です。

## 検証

```sh
npm run build
npm run typecheck
npm test
```

Node 標準の test runner を使用します。Linux の疑似端末テストには Python 3 の標準ライブラリーを使用します（CLI 実行時には Python は不要）。CI は Node.js 20・22・24 を対象とします。

テストは実 WebR での計算、変数保持、エラー復帰、改行なし出力、複数行、readline の回答・空文字、中断後の再評価、`.Last` と q() を確認します。子プロセス・疑似端末では非 TTY 拒否、起動失敗、貼り付け、Ctrl+C、Ctrl+D、SIGTERM、終了コードを確認します。

NODEFS は一時ディレクトリで作業ディレクトリ設定、`source()`、CSV の読み書き、日本語・空白を含むパス、アクセスエラー後の復帰を検証します。権限エラーのテストは Windows と root 実行時にはスキップします。無効なホストパスでは、説明付きエラーと期限内の異常終了を確認します。

Codespaces のブラウザー内ターミナルでは、日本語・IME、端末サイズ変更、貼り付け中の連続 Ctrl+C、操作後のカーソル表示を手動確認してください。疑似端末だけではブラウザー側のキー処理と描画を保証できません。
