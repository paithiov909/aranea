# aranea

Node.js 上で WebR を動かす、小さな対話型 R コンソールです。GitHub Codespaces の通常のターミナルを主な対象とします。

## 起動

Node.js 20 以上と npm が必要です。システムの R、Rscript、コンパイラーは不要です。

```sh
npm install
npm run build
npm start
```

ビルド後は `node dist/cli.js` でも起動できます。CLI の bin 名は `aranea` です。build は TypeScript の変換のみを行います。標準入力・標準出力が TTY の場合に起動し、パイプ入力は拒否します。

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

M0〜M3（導入、基本 REPL、複数行・readline、中断・終了）を実装しています。

- ホストのディレクトリはまだマウントしません。R の作業ディレクトリは WebR の仮想 FS 内です。
- NODEFS は M4 の別変更です。ホスト cwd を `/workspace` にマウントし、`source()` とファイル読み書きを検証する予定です。
- フルスクリーン TUI、補完、プロット表示、パッケージ・履歴の永続化、バッチ実行は対象外です。
- stdout/stderr は行単位です。改行なしの `cat()` は次の入力要求時にフラッシュして一行として表示します。バイト単位の端末出力再現はしません。
- 多行貼り付け時は先行して入力がエコーされ、後から継続プロンプトが並ぶ場合があります。実行順は維持します。
- pager、viewer、canvas 等の未対応メッセージには通知を表示します。

## 構成と WebR 0.6.0 への対応

`src/cli.ts` は起動、`src/terminal.ts` は readline と入力キュー、`src/webr.ts` は WebR API を扱います。WebR は完全固定し、SharedArrayBuffer チャネルを使用します。出力の消費者はアダプター内の `stream()` 一つです。入力は `writeConsole()` が改行を付加するため、追加の改行を付けません。

公開パッケージの型定義、source map、R.js を確認した上で、アダプターに次のバージョン依存の補助処理を入れています。依存ファイル自体は変更しません。

1. worker 内の `Module.webr.setPrompt` で TTY バッファをフラッシュします。
2. 入力待ちの中断は worker の `channel.read` に専用メッセージを送り、`Module._Rf_onintr()` を呼びます。標準 `interrupt()` の入力キュー reset が未完了の読み取りを取り残す競合を避けます。計算中は標準 `interrupt()` を使います。中断からの復帰時には無害な同期メッセージを送り、遅れて到着する古い入力要求が次の R コマンドを消費することを防ぎます。
3. R.js の終了処理が設定する worker の `process.exitCode` を、worker のイベントループが戻った時点で検出し、ストリームを閉じます。R の `q()` や `.Last` は置き換えません。

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

Codespaces のブラウザー内ターミナルでは、日本語・IME、端末サイズ変更、貼り付け中の連続 Ctrl+C、操作後のカーソル表示を手動確認してください。疑似端末だけではブラウザー側のキー処理と描画を保証できません。
