package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	startupFile string
}

func NewApp() *App {
	return &App{}
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

// OpenPath 读取指定路径的 Markdown 文件（供文件关联/双击打开使用）
func (a *App) OpenPath(path string) (map[string]interface{}, error) {
	return readMarkdown(path)
}

func readMarkdown(path string) (map[string]interface{}, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
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
