package devices

import "embed"

// EmbeddedDevicesFS holds the embedded default device templates.
//
//go:embed *
var EmbeddedDevicesFS embed.FS
