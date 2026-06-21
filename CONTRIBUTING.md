# Contributing to @lisp

Thank you for your interest in @lisp! There are several ways to contribute.

## 📦 Adding a Package

### Prerequisites
- Your package must be in a **git repository** (GitHub, Gitee, GitLab, or self-hosted)
- Package name must be **unique** across the @lisp ecosystem

### Package Structure

```
your-package/
  pkg.lsp          # Package definition (required)
  your-package.lsp # Main code file
  your-package.fas # Compiled version (optional)
  dialog.dcl       # DCL dialogs (optional)
  locale/          # i18n translations (optional)
```

### `pkg.lsp` Template

```lisp
(def-pkg '((:name . "your-package")
            (:full-name . "Your Package Display Name")
            (:author . "Your Name")
            (:email . "your@email.com")
            (:version . "1.0.0")
            (:description . "Brief description of what this package does")
            (:category . "tools")   ;; arch, elec, hvac, tools, dev, fun
            (:required . "base")    ;; dependencies
            (:files "your-package.fas" "your-package.lsp")
            (:url . "https://github.com/yourname/your-package")
            (:compatible . "AutoCAD")  ;; or ZWCAD, GStarCAD, BricsCAD
            (:free . t)
            (:opensource . t)))
```

### Register Your Package

```sh
git clone https://gitee.com/atlisp/packages.git
cd packages
git submodule add https://github.com/yourname/your-package.git
git add .
git commit -m "add package your-package"
git push
```

## 🐛 Reporting Issues

- **Bug reports**: [kernel issues](https://gitee.com/atlisp/atlisp-kernel/issues)
- **Package issues**: [package issues](https://gitee.com/atlisp/packages/issues)

## 💻 Developing the Kernel

See [kernel/AGENTS.md](kernel/AGENTS.md) for the development guide.

## 🌍 Translating

Help translate @lisp into your language:

1. Copy `src/locale/@lisp.zh.lang` to `src/locale/@lisp.<lang>.lang`
2. Translate the strings
3. Submit a PR

## 📢 Spread the Word

- ⭐ Star the repo on [GitHub](https://github.com/atlisp-org) / [Gitee](https://gitee.com/atlisp)
- 📺 Share your @lisp workflow on Bilibili / YouTube
- 💬 Join the community: QQ Group `1071980591`
