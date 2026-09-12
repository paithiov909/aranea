# aranea

A small R console and script runner powered by [WebR](https://github.com/r-wasm/webr/) on Node.js, primarily intended for the standard GitHub Codespaces terminal.

## Getting started

You need Node.js 20 or later and npm. No system R installation, Rscript executable, or compiler is required. The initial npm install requires network access.

From a checkout of this repository:

```sh
npm install
npm run build
npm start
```

After building, you can also start the console with `node dist/cli.js`. Running without arguments opens an interactive console and requires both stdin and stdout to be terminals; piped input is rejected.

```r
1 + 1
f <- function(x) {
  x + 1
}
f(41)
name <- readline("name: ")
```

Multiline expressions and pasted lines are processed in order. Ctrl+C cancels the current input or computation and discards queued paste input.

Use `q()` to quit without saving and run `.Last()`. Exit codes such as `q(save="no", status=7)` are passed through to Node.js. Ctrl+D on an empty input line closes the session without saving; `.Last()` is not guaranteed to run in this case or on SIGTERM. Sessions are not restored at startup.

## Running scripts and expressions

### Persistent server

```sh
aranea serve
aranea eval 'x <- 40'
aranea eval 'x + 2'
aranea shutdown
```

The server keeps one WebR session and its `.GlobalEnv` for the lifetime of the foreground process. Linux clients in the same absolute working directory connect through a deterministic socket under `/tmp`; there is no authentication or network transport.

`aranea shutdown` waits for previously accepted evaluations and R's `.Last` hook, then releases the listening socket before reporting success. You can restart with `aranea shutdown && aranea serve`. New evaluations are rejected once shutdown begins; if an accepted evaluation or `.Last` never finishes, shutdown continues waiting.

R exit codes are not currently propagated through `aranea eval`. For example, `aranea eval 'q(status=7)'` stops the R session but the client exits with code `1`, not `7`; even `aranea eval 'q()'` currently exits with code `1`. If the connection closes before a response arrives, the client may also report `Server closed the connection before responding`. This limitation is tracked in [issue #3](https://github.com/paithiov909/aranea/issues/3).

### One-shot scripts and expressions

```sh
node dist/cli.js script.R
node dist/cli.js -e "print('hello!')"
node dist/cli.js -- -script.R
node dist/cli.js --help
node dist/cli.js --version
```

A file or a single `-e` expression runs in non-interactive mode without requiring a terminal. There is no banner, console input prompt, or code echo. Visible expression results are printed automatically; assignment results are not. `interactive()` returns `FALSE`.

Script files are read as UTF-8. Relative and absolute paths, spaces and a leading shebang are supported. Diagnostics may refer to `/tmp/aranea-script.R`, the temporary copy used to execute the script inside WebR. The R working directory is `/workspace`, which corresponds to the directory where you launched aranea, regardless of the script's location.

Output is forwarded to stdout and stderr line by line during execution, and trailing output without a newline is flushed before exit. Execution stops on an uncaught error.

| Outcome | Exit code |
|---|---|
| Successful completion | `0` |
| Argument, file reading, initialization, syntax, or uncaught runtime error | `1` |
| Explicit `q(save="no", status=...)` | The requested status |
| SIGINT | `130` |
| SIGTERM | `143` |

Normal completion and explicit `q()` exit without saving and run `.Last()`. SIGINT and SIGTERM close the worker without guaranteeing `.Last()`. Initialization has a 30-second timeout; code execution has no time limit.

This is not a fully compatible replacement for Rscript. Script arguments, `commandArgs()` compatibility, multiple `-e` expressions, and code or data input from host stdin are not supported. `readLines(stdin())` sees EOF, and `readline()` prints its prompt and returns an empty string. Other console input requests terminate execution with an explanation.

## Working with host files

The directory where you launch aranea is mounted at `/workspace` and used as R's working directory. If setup fails, aranea reports the affected path and reason, then exits.

Place `script.R` and `input.csv` in that directory, then use relative paths from R:

```r
getwd() # "/workspace"
source("script.R")
data <- read.csv("input.csv")
write.csv(data, "output.csv", row.names = FALSE)
```

`output.csv` is created in the host directory where you launched aranea. Writes, overwrites, and deletions under `/workspace` directly affect real host files and persist after exit.

### Keeping installed R packages across sessions

WebR's default package library is reset for each session. Because aranea mounts your current host directory, packages installed there remain available across sessions, as long as they are compatible with the WebR version you use.

For example, install an R package into a `.cache` directory:

```r
# Disable mounting because the destination is already in a mounted directory.
webr::install("ggplot2", lib = ".cache", mount = FALSE)
```

In each new session, launch aranea from the same host directory and add `.cache` to R's library search path before loading the package:

```r
.libPaths(c(.libPaths(), ".cache"))
library(ggplot2)
```

## Installing a local package

This project has not been published to npm. `npx aranea` from the public registry may not refer to this repository's package. To install this checkout locally, first create a tarball in the repository:

```sh
npm pack
```

Then run the following in another project directory, replacing the path with the absolute path to your tarball:

```sh
npm install --omit=dev /absolute/path/aranea-0.1.0.tgz
npx --no-install aranea
npx --no-install aranea script.R
npx --no-install aranea -e "print('hello!')"
```

## Limitations

- There is no full-screen interface, completion, plot display, or command-history persistence. Package persistence requires installing into a host directory and setting the library path as described above.
- Output is line-based. In the interactive console, `cat()` output without a newline is flushed as a line at the next input request; byte-for-byte terminal output is not reproduced.
- Multiline pastes may echo ahead of execution, with continuation prompts appearing later. Execution order is preserved.
- Unsupported pager, viewer, canvas, and similar requests display a notice.

## Development

Architecture notes, verification instructions, and the implementation plan are maintained in Japanese in [DEVELOPMENT.md](DEVELOPMENT.md).
