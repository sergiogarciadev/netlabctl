package main

import (
	"flag"
	"os"

	"netlabctl/internal/logger"
	"netlabctl/internal/server"
	"netlabctl/internal/storage"
)

func main() {
	addrFlag := flag.String("addr", ":8080", "HTTP server listen address")
	dirFlag := flag.String("dir", "", "Custom path to application state directory (defaults to $HOME/.netlabctl)")
	flag.Parse()

	store, err := storage.NewStorage(*dirFlag)
	if err != nil {
		logger.Log.Error("Failed to initialize storage", "error", err)
		os.Exit(1)
	}

	logger.Log.Info("Initialized application state storage", "path", store.BaseDir())

	srv := server.NewServer(*addrFlag, store)
	if err := srv.Start(); err != nil {
		logger.Log.Error("Server stopped with error", "error", err)
		os.Exit(1)
	}
}
