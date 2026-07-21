//go:build !windows

package main

func flashTaskbar(count uint32) error { return nil }
