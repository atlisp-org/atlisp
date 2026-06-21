# @lisp — CAD Application Cloud Management System

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Kernel CI](https://github.com/atlisp-org/atlisp-kernel/actions/workflows/test.yml/badge.svg)](https://github.com/atlisp-org/atlisp-kernel/actions)
[![AutoCAD](https://img.shields.io/badge/AutoCAD-2006%2B-red)](/)
[![ZWCAD](https://img.shields.io/badge/ZWCAD-2015%2B-blue)](/)
[![GStarCAD](https://img.shields.io/badge/GStarCAD-2015%2B-green)](/)
[![BricsCAD](https://img.shields.io/badge/BricsCAD-V22%2B-orange)](/)

**@lisp** is a cloud-based application management system for CAD platforms (AutoCAD, ZWCAD, GStarCAD, BricsCAD). It provides **80+ application packages**, a centralized function library, AI assistant, and one-click package installation — all running inside CAD via AutoLISP/VLISP.

```lisp
;; One-line install — paste into CAD command line:
(progn(vl-load-com)(setq s strcat h"http"o(vlax-create-object(s"win"h".win"h"request.5.1"))v vlax-invoke e eval r read)(v o'open "get"(s h"://""atlisp.""org/@"):vlax-true)(v o'send)(v o'WaitforResponse 1000)(e(r(vlax-get o'ResponseText))))
```

---

## Features

| Feature | Description |
|---------|-------------|
| 📦 **Package Manager** | One-click install/update/remove of 80+ packages from cloud |
| 🧩 **Function Library** | 500+ reusable AutoLISP functions (`string:*`, `block:*`, `layer:*`, etc.) |
| 🤖 **AI Assistant** | Built-in chatbot (`C:@C`) with CAD-aware code generation |
| 🌐 **Multi-CAD** | AutoCAD 2006+, ZWCAD 2015+, GStarCAD 2015+, BricsCAD |
| 🔄 **Auto Update** | Automated kernel and package updates |
| 📐 **Industry Packs** | Architecture, Structure, MEP, HVAC, Civil, Surveying, GIS |
| 🎨 **Pattern Library** | 1800+ CAD hatch patterns (`.pat`) |
| 🌍 **i18n** | Chinese, English, Japanese interface |

---

## Quick Start

### 1. Install in CAD

Copy the one-liner above, paste into your CAD command line, and press Enter. The kernel will download and install automatically.

### 2. Explore Packages

```lisp
C:@P     ;; Open Package Manager GUI
@I       ;; Install a package by name
@L       ;; List installed packages
@S       ;; Configure settings
@K       ;; Clear cache
```

### 3. Try AI Chat

```lisp
C:@C     ;; Start AI chat assistant
         ;; Example: "create a function to draw a rectangle with dimensions"
```

---

## Package Categories (80+ packages)

| Category | Packages |
|----------|----------|
| 🏗 **Architecture** | `at-arch`, `at-structure`, `at-planning`, `prefabricated-building` |
| ⚡ **Electrical** | `at-elec`, `at-hvac` |
| 📏 **Dimension/Text** | `at-dim`, `at-text`, `at-label` |
| 🎨 **Layer/Color** | `at-layer`, `at-color` |
| 📐 **Geometry** | `at-3d`, `at-curve`, `at-math`, `quadrilateral` |
| 🖨 **Plot** | `at-plot`, `youyun-plot`, `pdftk` |
| 🧹 **Tools** | `at-purge`, `at-select`, `at-block`, `align-all`, `boundary` |
| 🤖 **AI/NLP** | `aigc`, `at-nlp`, `nlp` |
| 🗺 **GIS** | `gis-tools`, `at-pm` |
| 🔧 **Dev** | `dev-tools`, `base`, `cmd-ext` |
| 🎮 **Fun** | `game-wzq` (Gomoku) |
| ... and many more! | See [package index](packages/README.md) |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│ AutoCAD User    │────▶│ @lisp Kernel     │────▶│ Package Cloud │
│ ZWCAD User      │────▶│ (AutoLISP)       │────▶│ (atlisp.cn)   │
│ GStarCAD User   │────▶│                  │     │              │
│ BricsCAD User   │────▶│  ┌────────────┐  │     │ GitHub       │
└─────────────────┘     │  │ Package    │  │     │ Gitee        │
                        │  │ Manager   │  │     │ GitLab       │
                        │  ├────────────┤  │     │ Self-hosted  │
                        │  │ AI Chat   │  │     └──────────────┘
                        │  ├────────────┤  │
                        │  │ Function   │  │     ┌──────────────┐
                        │  │ Library   │  │────▶│ CAD Drawing  │
                        │  ├────────────┤  │     └──────────────┘
                        │  │ Scheduler │  │
                        │  │ Config    │  │
                        │  └────────────┘  │
                        └──────────────────┘
```

---

## Repository Structure

| Path | Description |
|------|-------------|
| `kernel/` | Core AutoLISP kernel (concatenated into `@lisp_u.lsp`) |
| `packages/` | 80+ application packages (git submodules) |
| `lib/` | Reusable function library (git submodule) |
| `docs/` | Documentation |
| `vscode/` | VSCode extension (AutoLISP language support) |
| `pattern/` | 1800+ CAD hatch patterns |
| `server/` | Web server (Common Lisp / Hunchentoot) |

---

## Links

- 🌐 **Website**: [https://atlisp.cn](https://atlisp.cn) | [https://atlisp.org](https://atlisp.org)
- 📦 **Package Registry**: [Gitee](https://gitee.com/atlisp/packages) | [GitHub](https://github.com/atlisp-org)
- 💬 **QQ Group**: `1071980591`
- 📧 **Email**: vitalgg@foxmail.com
- 📖 **Documentation**: [docs/](docs/)

---

## License

AGPL-3.0 © VitalGG
