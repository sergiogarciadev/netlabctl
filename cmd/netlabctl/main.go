package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

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

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := srv.Start(); err != nil {
			logger.Log.Error("Server stopped with error", "error", err)
			os.Exit(1)
		}
	}()

	sig := <-sigChan
	logger.Log.Info("Received OS termination signal", "signal", sig.String())

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Log.Error("Server graceful shutdown failed", "error", err)
		os.Exit(1)
	}
}
