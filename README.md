# MD Tool

一个面向不懂 Markdown 语法用户的桌面端 Markdown 编辑器。提供所见即所得（WYSIWYG）编辑体验，无需记忆任何 Markdown 语法即可编写文档，并支持打开/保存 `.md` 文件、导出 HTML。

- **作者**：hunter
- **邮箱**：1261660791@qq.com

## 技术架构

基于 [Wails](https://wails.io/) v2 构建，将前端（Web 技术）与后端（Go）打包成单一原生桌面程序（Windows 下为 WebView2）。

```
┌─────────────────────────────────────────────┐
│                桌面应用 (mdtool.exe)         │
│                                               │
│  ┌─────────────────┐      Bind(JSBridge)     │
│  │   前端 Frontend  │  ◄──────────────────►  │
│  │  React + Milkdown│     window.go.main.App  │
│  │   Crepe 编辑器   │                        │
│  └─────────────────┘                        │
│         │                                    │
│  ┌──────▼──────────┐                         │
│  │   后端 Backend   │                         │
│  │  Go (Wails Runtime)                        │
│  │  - OpenFile      │  文件系统读写 (.md/.html)│
│  │  - SaveFile      │                         │
│  │  - ExportFile    │                         │
│  └─────────────────┘                         │
└─────────────────────────────────────────────┘
```

### 目录结构

```
mdreview/
├── main.go              # Wails 应用入口，窗口/Webview 配置
├── app.go               # Go 后端：文件打开/保存/导出，绑定给前端调用
├── go.mod / go.sum      # Go 模块依赖
├── wails.json           # Wails 构建配置（前端 install/build 命令）
└── frontend/
    ├── package.json     # 前端依赖 (React, @milkdown/crepe, marked)
    ├── index.html
    ├── vite.config.ts   # Vite 开发/构建配置
    ├── tsconfig.json
    └── src/
        ├── main.tsx     # React 入口
        ├── App.tsx      # 编辑器主体 + 工具栏 + 快捷键
        ├── App.css      # 界面样式
        └── wails.d.ts   # 前端调用 Go 后端的类型声明
```

### 职责划分

- **前端（React + Milkdown Crepe）**：渲染所见即所得编辑器，提供格式化工具栏（加粗、标题、列表、表格等），通过 `window.go.main.App.*` 调用后端。
- **后端（Go + Wails）**：`app.go` 暴露三个方法供前端调用：
  - `OpenFile()`：弹出系统文件选择框，读取 `.md` 内容返回前端。
  - `SaveFile(content, currentPath)`：保存到文件（首次询问路径，之后直接覆盖）。
  - `ExportFile(content, ext)`：将内容导出为指定扩展名文件（如 `.html`）。

## 重要工程文件用途

- `main.go`：Go 程序入口。`wails.Run` 配置窗口标题、尺寸、启动回调；`main()` 中通过 `ParseStartupFile()` 解析命令行传入的 `.md` 路径存入 `App`。
- `app.go`：后端核心逻辑。文件读写（`OpenFile`/`SaveFile`/`ExportFile`）、双击打开（`OpenPath`）、启动文件传递（`GetStartupFile`）、命令行参数解析（`ParseStartupFile`）、通用读取（`readMarkdown`）。
- `wails.json`：Wails 构建配置。`name`/`outputfilename`（→`mdtool.exe`）、`productName`（→MD Tool）、前端 install/build 命令。
- `go.mod` / `go.sum`：Go 模块定义（`module mdreview`）与依赖版本锁定。
- `register-md.reg`：Windows 文件关联脚本。将 `.md`/`.markdown` 默认关联到 `mdtool.exe`，含程序图标、友好名「MD Tool 文档」、右键「打开方式」列表。
- `frontend/src/App.tsx`：前端主组件。Milkdown 编辑器初始化、工具栏（新建/打开/保存/导出/源码切换）、启动文件自动加载、状态栏版本信息。
- `frontend/src/App.css`：界面样式（工具栏、编辑器、源码区、状态栏）。
- `frontend/src/wails.d.ts`：后端 Go 方法的前端类型声明（`OpenFile`/`OpenPath`/`GetStartupFile`/`SaveFile`/`ExportFile`），供 TS 调用并校验。
- `frontend/package.json`：前端依赖与脚本（`mdtool-frontend`，含 React、Milkdown Crepe、marked）。
- `build/windows/installer/wails_tools.nsh`：NSIS 安装包脚本，`wails build` 时由 `wails.json` 自动生成，定义安装项目名/公司名（mdtool）。
- `build/appicon.png`：应用图标源，构建时生成 `mdtool.exe` 图标与 `.md` 文件关联图标。

## 环境要求

- **Go** >= 1.23（本项目使用 1.26.5，路径 `D:\dev\FlyEnv-Data\app\static-go-1.26.5`）
- **Node.js** >= 18（开发已用 v24）
- **Wails CLI** v2：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **Windows**：需 WebView2 Runtime（Win10/11 通常已内置）

将 Go 与 Wails 加入 PATH（已写入用户环境变量，新开终端自动生效）：

```powershell
$env:Path = "D:\dev\FlyEnv-Data\app\static-go-1.26.5\bin;C:\Users\Administrator.DESKTOP-G8HF258\go\bin;$env:Path"
```

验证：

```powershell
go version      # go version go1.26.5 windows/amd64
wails version   # v2.13.0
```

## 启动项目（开发模式）

首次需安装前端依赖：

```powershell
cd D:\dev\GolandProject\mdreview
npm install        # 在 frontend/ 下安装依赖（wails 也会自动调用）
```

启动开发服务器（带热重载，修改前端代码自动刷新）：

```powershell
wails dev
```

启动后自动弹出桌面窗口，同时起一个 Vite 服务（默认 `http://localhost:5173`）。修改 `frontend/src` 下的文件会即时生效；但修改 `main.go` / `app.go` 等 Go 代码需重启 `wails dev` 才能重新编译。

应用内快捷键：

- `Ctrl+O`：打开 `.md` 文件
- `Ctrl+S`：保存
- 顶部「导出」按钮：将当前文档导出为 HTML

停止开发进程：

```powershell
taskkill /f /im mdtool.exe
taskkill /f /im wails.exe
```

## 打包成可执行文件

在项目根目录执行：

```powershell
wails build
```

构建完成后，可执行文件位于 `build\mdtool.exe`，可独立分发给同版本 Windows 用户（无需安装 Go/Node）。

可选参数：

```powershell
wails build -nsis     # 生成 Windows 安装包（需先安装 NSIS），产物为 .exe 安装程序
wails build -upx      # 用 UPX 压缩体积（需先安装 upx）
wails build -clean    # 清理后重新构建
```

注意：`wails build` 依赖本机已安装 WebView2 Runtime；目标机器若未安装，运行时会提示下载。

## 常见问题

- **`wails: command not found`**：PATH 未包含 `$GOPATH/bin`，按上文把 Go/Wails 路径加入 PATH。
- **窗口内容偏小**：调整 `main.go` 中 `Windows.ZoomFactor`（默认 `1.0`）或 `Width`/`Height`，重启 `wails dev`。
- **编辑区宽度**：由 `frontend/src/App.css` 中 `.editor-wrapper` 的 `max-width` 控制（当前为占满整个窗口）。
