# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is / 项目简介

MD Tool (`mdtool`) is a WYSIWYG Markdown desktop editor for users who don't know Markdown syntax. Built with [Wails v2](https://wails.io/): a Go backend and a React + [Milkdown Crepe](https://milkdown.dev/) frontend packaged into a single native binary (WebView2 on Windows). The app lives in `mdreview/` — the repository root (`D:\dev\GolandProject`) is just the GoLand project wrapper.

面向不懂 Markdown 语法用户的所见即所得（WYSIWYG）桌面编辑器。基于 [Wails v2](https://wails.io/) 构建：Go 后端 + React 与 [Milkdown Crepe](https://milkdown.dev/) 前端，打包为单一原生程序（Windows 下用 WebView2）。实际代码都在 `mdreview/` 目录下，仓库根目录只是 GoLand 工程外壳。

## Commands / 常用命令

All commands run from `mdreview/`. The Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`) and `$GOPATH/bin` must be on PATH.
以下命令均在 `mdreview/` 下执行。需先安装 Wails CLI 并把 `$GOPATH/bin` 加入 PATH。

- `wails dev` — dev mode with hot-reload frontend (Vite on :5173) + native window. Editing `frontend/src/*` is instant; editing Go (`main.go`, `app.go`) requires restarting `wails dev` to recompile.
  开发模式，前端热重载（Vite :5173）+ 原生窗口。改 `frontend/src/*` 即时生效；改 Go 代码（`main.go`、`app.go`）需重启 `wails dev` 重新编译。
- `wails build` — produce `build/bin/mdtool.exe` (standalone, no Go/Node needed on target). Add `-nsis` (installer, needs NSIS), `-upx` (compress), `-clean`.
  构建独立可执行文件 `build/bin/mdtool.exe`（目标机器无需 Go/Node）。可加 `-nsis`（安装包，需 NSIS）、`-upx`（压缩）、`-clean`。
- `cd frontend && npm run build` — frontend-only build (`tsc && vite build` → `frontend/dist`). Wails embeds `frontend/dist` via `//go:embed`, so it must exist before `wails build`.
  仅构建前端（`tsc && vite build` → `frontend/dist`）。Wails 通过 `//go:embed` 嵌入 `frontend/dist`，所以 `wails build` 前该目录必须存在。
- Kill stuck dev processes / 结束卡住的进程：`taskkill /f /im mdtool.exe && taskkill /f /im wails.exe`.

There are no automated tests or linters configured. Release tags matching `v*` trigger `.github/workflows/release.yml`, which cross-builds Windows + macOS artifacts. Note CI and `go.mod` pin **Go 1.25**; the README's mention of 1.26.5 refers to one dev machine.
项目没有配置自动化测试或 linter。推送 `v*` 标签会触发 `.github/workflows/release.yml`，交叉构建 Windows + macOS 产物。注意 CI 与 `go.mod` 锁定 **Go 1.25**；README 里的 1.26.5 只是某台开发机的版本。

## Architecture / 架构

### Go ↔ JS bridge / Go 与前端桥接

`app.go` defines the `App` struct; every exported method on it is auto-bound and callable from the frontend as `window.go.main.App.<Method>()`. When you add or change a bound Go method, the generated bindings in `frontend/wailsjs/go/main/` regenerate on the next `wails dev`/`build`, and you must also update the hand-maintained type declarations in `frontend/src/wails.d.ts` or TypeScript calls won't type-check. Wails runtime helpers (window position, events) are reached via `window.runtime.*`.

`app.go` 定义 `App` 结构体，其上所有导出方法都会被自动绑定，前端通过 `window.go.main.App.<方法名>()` 调用。新增或修改绑定方法后，`frontend/wailsjs/go/main/` 里的生成绑定会在下次 `wails dev`/`build` 时重新生成，但你还必须手动更新 `frontend/src/wails.d.ts` 里的类型声明，否则 TS 调用无法通过类型检查。Wails 运行时能力（窗口位置、事件）通过 `window.runtime.*` 访问。

Backend responsibilities are file-system only: `OpenFile`/`SaveFile`/`ExportFile` (dialog-driven), `OpenPath`/`readMarkdown` (read a given path), `SaveImage` (decode base64 → `assets/`), plus the window/instance coordination below. All editor logic lives in the frontend.
后端只负责文件系统操作：`OpenFile`/`SaveFile`/`ExportFile`（弹窗驱动）、`OpenPath`/`readMarkdown`（按路径读取）、`SaveImage`（base64 解码写入 `assets/`），以及下述的窗口/实例协调。编辑器逻辑全部在前端。

### Multi-window + multi-tab with cross-window drag / 多窗口 + 多标签页 + 跨窗口拖拽（最复杂的部分）

The app supports multiple top-level windows, each holding multiple tabs, and dragging a tab from one window into another. This is coordinated through several cooperating pieces — understand all of them before touching tab or window code:
应用支持多个顶层窗口，每个窗口有多个标签页，且能把标签页从一个窗口拖入另一个窗口。这由多个协作机制共同实现——改动标签页或窗口代码前请先理解全部：

- **Single-instance lock with dynamic UID** (`main.go`): normally all launches funnel into one process via `SingleInstanceLock.UniqueId = "MDTool-md"`, and a second launch fires the `second-instance` event carrying its args (used to open a double-clicked `.md` in the existing window). Two CLI flags bend this: `--new-window` assigns a random unique UID so the process gets its *own* window (used when detaching a tab); `--target-uid <uid>` forces a launch to be captured by a specific existing window's lock (used to send a tab *into* that window). `OpenInNewWindow` and `SendTabToWindow` in `app.go` spawn `os.Executable()` with these flags, writing unsaved content to a temp file first.
  **带动态 UID 的单实例锁**（`main.go`）：默认所有启动都通过 `SingleInstanceLock.UniqueId = "MDTool-md"` 汇聚到同一进程，第二次启动会触发 `second-instance` 事件并携带参数（用于在已有窗口打开被双击的 `.md`）。两个命令行参数改变此行为：`--new-window` 分配随机 UID 让进程拥有*自己*的窗口（拖出标签页时用）；`--target-uid <uid>` 强制新启动被指定窗口的锁拦截（把标签页*送入*该窗口时用）。`app.go` 的 `OpenInNewWindow` 和 `SendTabToWindow` 用这些参数启动 `os.Executable()`，未保存内容会先写入临时文件。
- **Shared window registry** (`app.go`): every window writes its pid/uid/position/size into `os.TempDir()/mdtool_windows.json` (`RegisterWindow`), polled by all windows every 500ms in `App.tsx`. Entries older than 2s are treated as dead. This is how a dragging window knows where the other windows are on screen to compute drop targets. It's a best-effort file-based IPC, not authoritative — expect stale/racy entries.
  **共享窗口注册表**（`app.go`）：每个窗口把自己的 pid/uid/位置/尺寸写入 `os.TempDir()/mdtool_windows.json`（`RegisterWindow`），`App.tsx` 里所有窗口每 500ms 轮询一次，超过 2 秒未更新的项视为失效。拖拽窗口据此得知其他窗口在屏幕上的位置以计算落点目标。这是尽力而为的文件 IPC，非权威数据——会有过期/竞态条目。
- **Drag logic** (`App.tsx`, the big `pointermove`/`pointerup` effect): pointer capture on a tab drives three behaviors depending on context — reorder within the bar (hovering another tab), move the whole window (when only one tab exists), or detach/send (drop outside, or over another window's screen rect from the registry).
  **拖拽逻辑**（`App.tsx` 中较大的 `pointermove`/`pointerup` effect）：标签页上的指针捕获根据上下文产生三种行为——栏内重排（悬停到另一标签页上）、移动整个窗口（只有一个标签页时）、拖出/发送（拖到窗口外，或落在注册表中另一窗口的屏幕矩形内）。

### Tab state via refs, not just React state / 标签页状态用 ref 而非仅 React state

`App.tsx` keeps the source of truth in **refs** (`tabsRef`, `activeIdRef`, `nextIdRef`) mirrored into state for rendering. This is deliberate: async callbacks (drag handlers, Go promises, editor events) need the current value without stale closures. When modifying tab logic, update the ref *and* call `setTabs`/`setActive` together, following the existing `patchActive`/`setActive` pattern — don't rely on state alone inside callbacks.

`App.tsx` 把真实状态存在 **ref**（`tabsRef`、`activeIdRef`、`nextIdRef`）里，再镜像到 state 用于渲染。这是有意为之：异步回调（拖拽处理、Go promise、编辑器事件）需要拿到最新值，避免闭包过期。修改标签页逻辑时，要同时更新 ref *和* 调用 `setTabs`/`setActive`，遵循现有的 `patchActive`/`setActive` 模式——不要在回调里只依赖 state。

The Crepe editor is a single instance reused across tabs. Switching tabs pulls current markdown out of the editor (`getMarkdown`), stashes it on the outgoing tab, then loads the incoming tab's content via `replaceAll`. The `loadingRef` guard suppresses the `markdownUpdated` event during programmatic loads so tabs aren't spuriously marked modified.
Crepe 编辑器是跨标签页复用的单一实例。切换标签页时，先从编辑器取出当前 markdown（`getMarkdown`）存回旧标签页，再用 `replaceAll` 载入新标签页内容。`loadingRef` 守卫会在程序化载入期间抑制 `markdownUpdated` 事件，避免标签页被误标为已修改。

### Image path rewriting / 图片路径重写

Images are stored relative (`assets/foo.png`) on disk but must be absolute (`file:///<dir>/assets/foo.png`) for WebView to render them. `toAbsImages` runs on load, `toRelImages` runs before save (`handleSave`), and pasted/uploaded images go through `SaveImage` (Go) which writes into an `assets/` dir next to the document and returns the relative path. A tab with no saved path falls back to inlining images as data URLs.
磁盘上图片按相对路径存储（`assets/foo.png`），但 WebView 渲染需要绝对路径（`file:///<dir>/assets/foo.png`）。`toAbsImages` 在载入时执行，`toRelImages` 在保存前（`handleSave`）执行，粘贴/上传的图片经 `SaveImage`（Go）写入文档同级的 `assets/` 目录并返回相对路径。未保存路径的标签页则回退为把图片内联为 data URL。

## Conventions / 约定

- UI strings, comments, and the README are in Chinese; keep that consistent when editing user-facing text.
  UI 文案、注释和 README 都用中文；编辑用户可见文本时保持一致。
- HTML export lazy-imports `marked` in the browser; PDF export is wired in the dialog filter but only writes raw content.
  HTML 导出在浏览器里懒加载 `marked`；PDF 导出在弹窗过滤器里接好了，但目前只写入原始内容。
- `register-md.reg` associates `.md`/`.markdown` with `mdtool.exe` on Windows (file icon, "打开方式" entry) — relevant to the startup-file flow (`ParseStartupFile` → `GetStartupFile` → auto-open on launch).
  `register-md.reg` 在 Windows 上把 `.md`/`.markdown` 关联到 `mdtool.exe`（文件图标、"打开方式"条目）——与启动文件流程相关（`ParseStartupFile` → `GetStartupFile` → 启动时自动打开）。
