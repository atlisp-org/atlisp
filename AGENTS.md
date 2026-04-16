# @lisp CAD应用云管理系统 — Agent Instructions

## Repo Structure

Root monorepo with 4 git submodules. Submodules may not be initialized; clone with:
```sh
git submodule update --init --recursive
git submodule foreach git checkout main
```

Sync submodules: `./sync-all.sh` (hardcoded to `~/atlisp`, must run from home)

### Directories
- `kernel/` — CAD client kernel (separate git repo, not submodule)
- `packages/` — git submodule; ~90 @lisp application packages
- `lib/` — git submodule; function library (one `.lsp` per function under `src/`)
- `docs/` — git submodule; documentation
- `vscode/` — git submodule; VSCode extension
- `pattern/` — CAD hatch patterns (~1800 `.pat` files, not source)
- `private-packages/` — private packages

## VSCode Extension (vscode/)

Only non-trivial build. Commands from `vscode/` directory:
```sh
npm install
npm run esbuild          # dev: sourcemaps -> dist/main.js
npm run esbuild-watch    # watch mode
npm run vscode:prepublish # prod: minify + pre-build
npm run test-compile     # TypeScript check only
```

Pipeline: `pre-build.js` → `merge-snippets.js` → esbuild minify.

Entry: `src/extension.ts`. Output: `dist/main.js`.

Language IDs: `autolisp` (.lsp, .mnl), `autolispdcl` (.dcl).

No test runner configured.

## Package Conventions

Each package needs `pkg.lsp` at root (package definition).

### Function library (lib/src/)
- One `.lsp` file per function
- Path determines namespace: `src/color/rgb2truecolor.lsp` → `color:rgb2truecolor`
- Format (for doc gen):
```lisp
(defun block:insert (para)
  "功能说明"
  "返回值类型"
  "示例"
  ;; impl
)
```

## Encoding
Use **UTF-8**. GB2312/ANSI breaks bracket matching in CAD.

## CAD Compatibility
AutoCAD 2006+, GstarCAD 2015+, ZWCAD 2015+, BricsCAD, VLISP-compatible CAD.
