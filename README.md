# aranea

A small R console and script runner powered by [WebR](https://github.com/r-wasm/webr/) and Node.js.

aranea lets you run R without installing a system R distribution. It is primarily intended for terminal-based environments such as GitHub Codespaces.

## Getting started

Requires Node.js 20 or later.

Install aranea globally with npm:

```sh
npm install -g @paithiov909/aranea
```

Then start an interactive R console:

```sh
aranea
```

Running `aranea` without arguments opens an interactive WebR session.

```r
> 1 + 1
[1] 2

> x <- 40
> x + 2
[1] 42
```

Multiline expressions and pasted code are supported. Press Ctrl+C to cancel the current input or computation, and use `q()` to quit.

Sessions start fresh each time and are not automatically restored.

## Working with host files

The directory where you launch aranea is mounted inside WebR as `/workspace` and becomes the R working directory.

For example, if `script.R` and `input.csv` are in your current directory:

```r
getwd()
# [1] "/workspace"

source("script.R")

data <- read.csv("input.csv")
write.csv(data, "output.csv", row.names = FALSE)
```

Files created or modified under `/workspace` are written directly to the corresponding host directory.

## Keeping R packages across sessions

WebR's default package library is temporary, but packages can be installed into a directory inside your workspace and reused across sessions.

For example:

```r
webr::install("ggplot2", lib = ".cache", mount = FALSE)
```

Then add that directory to the library search path in later sessions:

```r
.libPaths(c(.libPaths(), ".cache"))
library(ggplot2)
```

You need to launch aranea from the same host directory for the installed packages to remain available.

## Persistent sessions

aranea can keep a WebR session running in a foreground server process.

Start the server:

```sh
aranea serve
```

Then, from another terminal in the same working directory, evaluate code in that session:

```sh
aranea eval 'x <- 40'
aranea eval 'x + 2'
```

Because the same WebR session is reused, objects in `.GlobalEnv` remain available between evaluations.

Stop the server with:

```sh
aranea shutdown
```

## Running scripts and expressions

You can also run R code without starting an interactive console.

Run a script:

```sh
aranea script.R
```

Evaluate a single expression:

```sh
aranea -e "1 + 1"
```

Script and expression execution runs non-interactively. Visible expression results are printed automatically, while assignments are not.

The R working directory is `/workspace`, corresponding to the host directory where aranea was launched.

For filenames beginning with `-`, use `--`:

```sh
aranea -- -script.R
```

aranea is not intended to be a fully compatible replacement for `Rscript`. In particular, script arguments, `commandArgs()` compatibility, multiple `-e` expressions, and interactive stdin input are not currently supported.

## Experimental VS Code integration

aranea can be used as the R terminal for the [VS Code R extension](https://marketplace.visualstudio.com/items?itemName=REditorSupport.r).

For example, in GitHub Codespaces you can add the following to `.vscode/settings.json`:

```json
{
  "r.rterm.linux": "/home/codespace/nvm/current/bin/aranea",
  "r.rterm.option": [],
  "r.lsp.enabled": false,
  "r.lsp.promptToInstall": false
}
```

With this setup, code can be sent to the aranea console with Ctrl+Enter. The exact path to aranea depends on how Node.js and npm are installed.

This integration is limited and experimental. Features that expect a native R installation or tighter integration with the R extension may not work. In particular, Run Source (Ctrl+Shift+S) is not currently supported.

This behavior depends on the current implementation of the VS Code R extension and is not part of aranea's stable interface.

## Limitations

* Currently supports Linux only.
* aranea does not currently provide completion, plot display, a full-screen interface, or persistent command history.
* Installed R packages are not persisted automatically; install them into a host-mounted directory if you want to reuse them.
* Output is line-oriented and may differ slightly from a native R terminal in some edge cases.
* Pager, viewer, canvas, and similar WebR requests are not supported.
* R exit codes are not currently propagated correctly through `aranea eval`. For example, `aranea eval 'q(status=7)'` currently exits with status `1`. See [issue #3](https://github.com/paithiov909/aranea/issues/3).

## Development

Architecture notes, development details, and verification instructions are available in [DEVELOPMENT.md](DEVELOPMENT.md).
