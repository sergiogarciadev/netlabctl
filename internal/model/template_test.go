package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestMachineTemplateQEMUArgsAndDeviceOpts(t *testing.T) {
	jsonStr := `{
		"id": "mikrotik-32ports",
		"name": "Mikrotik CHR (32 ports)",
		"qemu_args": [
			"-device", "pci-bridge,chassis_nr=1,id=bridge1",
			"-device", "pci-bridge,chassis_nr=2,id=bridge2"
		],
		"ports": [
			{
				"id": "device-port-1",
				"name": "ether-1",
				"device": "virtio-net-pci",
				"device_opts": "bus=bridge1"
			},
			{
				"id": "device-port-17",
				"name": "ether-17",
				"device": "virtio-net-pci",
				"device_opts": "bus=bridge2"
			}
		]
	}`

	var tmpl MachineTemplate
	if err := json.Unmarshal([]byte(jsonStr), &tmpl); err != nil {
		t.Fatalf("Failed to unmarshal machine template JSON: %v", err)
	}

	expectedArgs := []string{
		"-device", "pci-bridge,chassis_nr=1,id=bridge1",
		"-device", "pci-bridge,chassis_nr=2,id=bridge2",
	}

	actualArgs := tmpl.GetQEMUArgs()
	if !reflect.DeepEqual(actualArgs, expectedArgs) {
		t.Errorf("GetQEMUArgs() mismatch: expected %v, got %v", expectedArgs, actualArgs)
	}

	if len(tmpl.Ports) != 2 {
		t.Fatalf("Expected 2 ports, got %d", len(tmpl.Ports))
	}

	if tmpl.Ports[0].DeviceOpts != "bus=bridge1" {
		t.Errorf("Port 0 device_opts expected 'bus=bridge1', got '%s'", tmpl.Ports[0].DeviceOpts)
	}

	if tmpl.Ports[1].DeviceOpts != "bus=bridge2" {
		t.Errorf("Port 1 device_opts expected 'bus=bridge2', got '%s'", tmpl.Ports[1].DeviceOpts)
	}
}
