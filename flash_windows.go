//go:build windows

package main

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procFlashWindowEx            = user32.NewProc("FlashWindowEx")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
)

const (
	FLASHW_STOP      = 0
	FLASHW_CAPTION   = 0x00000001
	FLASHW_TRAY      = 0x00000002
	FLASHW_ALL       = 0x00000003
	FLASHW_TIMER     = 0x00000004
	FLASHW_TIMERNOFG = 0x0000000C
)

type FLASHWINFO struct {
	cbSize    uint32
	hwnd      windows.HWND
	dwFlags   uint32
	uCount    uint32
	dwTimeout uint32
}

func flashTaskbar(count uint32) error {
	pid := windows.GetCurrentProcessId()
	var target windows.HWND

	enumProc := syscall.NewCallback(func(hwnd windows.HWND, _ uintptr) uintptr {
		if target != 0 {
			return 0
		}
		visible, _, _ := procIsWindowVisible.Call(uintptr(hwnd))
		if visible == 0 {
			return 1
		}
		var wp uint32
		_, _, _ = procGetWindowThreadProcessId.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&wp)))
		if wp == uint32(pid) {
			target = hwnd
			return 0
		}
		return 1
	})

	procEnumWindows.Call(enumProc, 0)
	if target == 0 {
		return nil
	}

	fi := FLASHWINFO{
		cbSize:    uint32(unsafe.Sizeof(FLASHWINFO{})),
		hwnd:      target,
		dwFlags:   FLASHW_ALL,
		uCount:    count,
		dwTimeout: 0,
	}
	_, _, err := procFlashWindowEx.Call(uintptr(unsafe.Pointer(&fi)))
	if err != nil && err != windows.ERROR_SUCCESS {
		return err
	}
	return nil
}
