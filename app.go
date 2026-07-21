package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	startupFile string
	uid         string
}

type windowEntry struct {
	Pid int    `json:"pid"`
	Uid string `json:"uid"`
	X   int    `json:"x"`
	Y   int    `json:"y"`
	W   int    `json:"w"`
	H   int    `json:"h"`
	Ts  int64  `json:"ts"`
}

var (
	windowsMu   sync.Mutex
	windowsFile = filepath.Join(os.TempDir(), "mdtool_windows.json")

	lockMu    sync.Mutex
	lockFiles = map[string]*os.File{}
)

func lockFile(path string) {
	lockMu.Lock()
	defer lockMu.Unlock()
	if _, ok := lockFiles[path]; ok {
		return
	}
	f, err := lockFileOpen(path)
	if err != nil {
		return
	}
	lockFiles[path] = f
}

func unlockFile(path string) {
	lockMu.Lock()
	defer lockMu.Unlock()
	if f, ok := lockFiles[path]; ok {
		f.Close()
		delete(lockFiles, path)
	}
}

func unlockAllFiles() {
	lockMu.Lock()
	defer lockMu.Unlock()
	for p, f := range lockFiles {
		f.Close()
		delete(lockFiles, p)
	}
}

func NewApp() *App {
	return &App{}
}

func loadWindows() map[string]windowEntry {
	m := map[string]windowEntry{}
	data, err := os.ReadFile(windowsFile)
	if err == nil {
		_ = json.Unmarshal(data, &m)
	}
	return m
}

func saveWindows(m map[string]windowEntry) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return os.WriteFile(windowsFile, data, 0644)
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ParseStartupFile 从命令行参数中提取第一个已存在的 .md 文件路径
func ParseStartupFile() string {
	for _, arg := range os.Args[1:] {
		lower := strings.ToLower(arg)
		if strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown") {
			if _, err := os.Stat(arg); err == nil {
				return arg
			}
		}
	}
	return ""
}

// GetStartupFile 返回程序启动时通过命令行传入的 .md 文件路径
func (a *App) GetStartupFile() string {
	return a.startupFile
}

// GetPid 返回当前进程 ID，供前端在窗口表中定位自身
func (a *App) GetPid() int {
	return os.Getpid()
}

// RegisterWindow 把当前窗口的位置/尺寸写入共享表（含自身 uid）
func (a *App) RegisterWindow(x, y, w, h int) error {
	windowsMu.Lock()
	defer windowsMu.Unlock()
	m := loadWindows()
	m[strconv.Itoa(os.Getpid())] = windowEntry{
		Pid: os.Getpid(), Uid: a.uid, X: x, Y: y, W: w, H: h, Ts: time.Now().Unix(),
	}
	return saveWindows(m)
}

// GetWindows 返回近期活跃窗口列表（剔除超过 2 秒未更新的残留项）
func (a *App) GetWindows() []map[string]interface{} {
	windowsMu.Lock()
	defer windowsMu.Unlock()
	m := loadWindows()
	now := time.Now().Unix()
	out := []map[string]interface{}{}
	for _, e := range m {
		if now-e.Ts > 2 {
			continue
		}
		out = append(out, map[string]interface{}{
			"pid": e.Pid, "uid": e.Uid, "x": e.X, "y": e.Y, "w": e.W, "h": e.H,
		})
	}
	return out
}

// UnregisterWindow 关闭时从共享表移除自身并释放所有文件锁
func (a *App) UnregisterWindow() error {
	unlockAllFiles()
	windowsMu.Lock()
	defer windowsMu.Unlock()
	m := loadWindows()
	delete(m, strconv.Itoa(os.Getpid()))
	return saveWindows(m)
}

// OpenPath 读取指定路径的 Markdown 文件（供文件关联/双击打开使用）
func (a *App) OpenPath(path string) (map[string]interface{}, error) {
	return readMarkdown(path)
}

// OpenInNewWindow 把当前标签页在新窗口中打开：启动自身的新进程，
// 若该标签页尚未保存则先把内容写入临时文件再传入路径。
func (a *App) OpenInNewWindow(path string, content string) error {
	target := path
	if target == "" {
		tmp := filepath.Join(os.TempDir(), fmt.Sprintf("mdtool-%d.md", time.Now().UnixNano()))
		if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
			return err
		}
		target = tmp
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--new-window", target)
	return cmd.Start()
}

// SendTabToWindow 把标签页发送到指定 uid 的窗口：启动自身新进程并携带
// --target-uid，使其被目标窗口的单实例锁拦截，从而触发目标窗口合并该 tab。
func (a *App) SendTabToWindow(targetUid string, path string, content string) error {
	target := path
	if target == "" {
		tmp := filepath.Join(os.TempDir(), fmt.Sprintf("mdtool-%d.md", time.Now().UnixNano()))
		if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
			return err
		}
		target = tmp
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--target-uid", targetUid, target)
	return cmd.Start()
}

func readMarkdown(path string) (map[string]interface{}, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	lockFile(path)
	return map[string]interface{}{
		"path":    path,
		"content": string(content),
		"name":    filepath.Base(path),
	}, nil
}

func (a *App) OpenFile() (map[string]interface{}, error) {
	file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || file == "" {
		return nil, err
	}

	return readMarkdown(file)
}

func (a *App) SaveFile(content string, currentPath string) (map[string]interface{}, error) {
	if currentPath != "" {
		err := os.WriteFile(currentPath, []byte(content), 0644)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"path": currentPath,
			"name": filepath.Base(currentPath),
		}, nil
	}

	file, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存 Markdown 文件",
		DefaultFilename: "document.md",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md"},
		},
	})
	if err != nil || file == "" {
		return nil, err
	}

	err = os.WriteFile(file, []byte(content), 0644)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"path": file,
		"name": filepath.Base(file),
	}, nil
}

// GetFileModTime 返回文件修改时间（纳秒），文件不存在返回 0
func (a *App) GetFileModTime(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.ModTime().UnixNano()
}

// ReadFile 按路径读取 Markdown 文件内容
func (a *App) ReadFile(path string) (map[string]interface{}, error) {
	return readMarkdown(path)
}

// FileExists 判断文件是否存在
func (a *App) FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (a *App) SaveImage(dir string, filename string, data string) (string, error) {
	if dir == "" {
		wd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		dir = wd
	}
	if i := strings.Index(data, ","); i >= 0 {
		data = data[i+1:]
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	assetsDir := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		return "", err
	}
	name := filepath.Base(filename)
	out := filepath.Join(assetsDir, name)
	for i := 1; ; i++ {
		if _, err := os.Stat(out); err != nil {
			break
		}
		ext := filepath.Ext(name)
		base := strings.TrimSuffix(name, ext)
		out = filepath.Join(assetsDir, fmt.Sprintf("%s_%d%s", base, i, ext))
	}
	if err := os.WriteFile(out, b, 0644); err != nil {
		return "", err
	}
	return "assets/" + filepath.Base(out), nil
}

func (a *App) ExportFile(content string, ext string) error {
	var filter runtime.FileFilter
	switch ext {
	case ".html":
		filter = runtime.FileFilter{DisplayName: "HTML 文件 (*.html)", Pattern: "*.html"}
	case ".pdf":
		filter = runtime.FileFilter{DisplayName: "PDF 文件 (*.pdf)", Pattern: "*.pdf"}
	default:
		filter = runtime.FileFilter{DisplayName: "所有文件 (*.*)", Pattern: "*.*"}
	}

	file, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出文件",
		DefaultFilename: "document" + ext,
		Filters:         []runtime.FileFilter{filter},
	})
	if err != nil || file == "" {
		return err
	}

	return os.WriteFile(file, []byte(content), 0644)
}

func (a *App) FlashTaskbar(count int) {
	_ = flashTaskbar(uint32(count))
}

func (a *App) UnlockFile(path string) {
	unlockFile(path)
}
