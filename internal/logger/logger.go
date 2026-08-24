package logger

import (
	"log/slog"
	"os"
)

var (
	LogLevelVar = new(slog.LevelVar)
	Log         *slog.Logger
)

func init() {
	LogLevelVar.Set(slog.LevelDebug)
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: LogLevelVar,
	})
	Log = slog.New(handler)
}

// SetLevel updates log verbosity safely without reassigning the global logger pointer.
func SetLevel(level slog.Level) {
	LogLevelVar.Set(level)
}
