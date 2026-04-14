# @lisp CAD应用云管理系统 — Agent Instructions

## Repo Structure

This is the **root monorepo** for the @lisp ecosystem. It contains 4 git submodules and several top-level directories.

### Submodules (must be cloned separately)
- `packages/` — application package registry (gitee.com/atlisp/packages)
- `lib/` — @lisp function library, one `.lsp` file per function under `src/`
- `docs/` — documentation (gitee.com/atlisp/atlisp-docs)
- `vscode/` — VSCode extension source (gitee.com/atlisp/atlispext)

After cloning, initialize submodules:
```sh
git submodule update --init --recursive
git submodule foreach git checkout main
```

Sync all submodules: `./sync-all.sh` (requires running from `~/atlisp`)

### Top-level directories
- `kernel/` — @lisp CAD client kernel (self-contained, its own git repo)
- `packages/` — **git submodule**; contains ~75 @lisp application packages
- `lib/` — **git submodule**; @lisp function library source
- `docs/` — **git submodule**; documentation
- `vscode/` — **git submodule**; VSCode extension source
- `pattern/` — CAD hatch pattern (`.pat`) files, ~1800 files, not source code
- `private-packages/` — private/non-distributed packages

## VSCode Extension Development

The only non-trivial build step is the `vscode/` subdirectory.

### Build commands (from `vscode/` directory)
```sh
npm install              # install deps
npm run esbuild          # dev build with sourcemaps -> dist/main.js
npm run esbuild-watch    # watch mode
npm run vscode:prepublish # production build (minifies, runs pre-build tools)
npm run test-compile     # TypeScript compile check only (no test runner)
```

### Build pipeline
`vscode:prepublish` runs: `tools/pre-build.js` (generates `syntaxes/autolisp.tmLanguage.json` from snippet keys) → `merge-snippets.js` → esbuild minify.

The extension entry point is `src/extension.ts`. Output is `dist/main.js`.

### Language IDs
- `autolisp` — `.lsp`, `.mnl` files
- `autolispdcl` — `.dcl` files

### Testing
No test runner is configured in `package.json`. The `devDependencies` include mocha, chai, ts-node, nyc, but no test script or test files are present.

## @lisp Package Conventions

Each package in `packages/` must contain a `pkg.lsp` file at its root (the package definition).

### Function library conventions (`lib/src/`)
- One function per `.lsp` file
- File location under `src/` determines function namespace: e.g. `src/color/rgb2truecolor.lsp` → function `color:rgb2truecolor`
- Function definition format (for doc generation):
```lisp
(defun block:insert (para)
  "函数功能说明"
  "返回值类型"
  "示例代码"
  ;; implementation
)
```

## Encoding
All LSP source files use **UTF-8** encoding. Using GB2312/ANSI causes bracket mismatch issues in the CAD environment.

## CAD Compatibility
@lisp targets: AutoCAD 2006+, GstarCAD 2015+, ZWCAD 2015+, BricsCAD, and other VLISP-compatible CAD platforms.
