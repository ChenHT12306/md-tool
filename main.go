package main

import (
	"embed"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	app.startupFile = ParseStartupFile()

	// 拖出生成的独立窗口带 --new-window 参数，使用随机 UniqueId 绕过单实例锁；
	// 跨窗口合并用 --target-uid <uid>，使新进程被目标窗口锁拦截并触发其 second-instance。
	uniqueId := "MDTool-md"
	for i := 0; i < len(os.Args[1:]); i++ {
		a := os.Args[1+i]
		if a == "--new-window" {
			uniqueId = fmt.Sprintf("MDTool-md-detached-%d", time.Now().UnixNano())
		} else if a == "--target-uid" && i+1 < len(os.Args[1:]) {
			uniqueId = os.Args[2+i]
		}
	}
	app.uid = uniqueId

	err := wails.Run(&options.App{
		Title:     "MD Tool - Markdown 编辑器",
		Width:     1440,
		Height:    960,
		MinWidth:  880,
		MinHeight: 660,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: uniqueId,
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				runtime.EventsEmit(app.ctx, "second-instance", secondInstanceData.Args)
			},
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
			WebviewUserDataPath:  "",
			ZoomFactor:           1.0,
			IsZoomControlEnabled: true,
			DisablePinchZoom:     false,
		},
	})

	if err != nil {
		log.Fatal(err)
	}
}
