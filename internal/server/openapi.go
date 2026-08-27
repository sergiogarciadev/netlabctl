package server

import (
	"net/http"
)

// handleSwaggerJSON serves the OpenAPI 3.0 spec in JSON format.
func (s *Server) handleSwaggerJSON(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_, _ = w.Write([]byte(openAPISpecJSON))
}

// handleSwaggerUI serves the interactive Swagger UI HTML page.
func (s *Server) handleSwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(swaggerUIHTML))
}

const swaggerUIHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>netlabctl API - Swagger UI</title>
  <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/favicon-32x32.png" sizes="32x32" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin:0; background: #0b0f19; color: #f8fafc; font-family: sans-serif; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui { filter: invert(88%) hue-rotate(180deg); }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui .scheme-container { background: #1e293b; box-shadow: none; border-radius: 8px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "/swagger/doc.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>
`

const openAPISpecJSON = `{
  "openapi": "3.0.3",
  "info": {
    "title": "netlabctl REST & WebSocket API",
    "description": "API specification for netlabctl network lab simulation management tool. Provides endpoints for managing device templates, disk images, topology projects, node instances, QEMU simulation controls, and real-time WebSockets.",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "/",
      "description": "Current Server Instance"
    }
  ],
  "tags": [
    { "name": "Templates", "description": "Device template management" },
    { "name": "Images", "description": "Dedicated disk image management" },
    { "name": "Projects", "description": "Topology project management" },
    { "name": "Simulation", "description": "Lab simulation lifecycle control (start, stop, force stop)" },
    { "name": "Nodes", "description": "Node machine power and disk overlay controls" },
    { "name": "WebSockets", "description": "Real-time telemetry, canvas events, and serial console" }
  ],
  "paths": {
    "/api/templates": {
      "get": {
        "tags": ["Templates"],
        "summary": "List available device machine templates",
        "operationId": "listTemplates",
        "responses": {
          "200": {
            "description": "List of templates",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/MachineTemplate" }
                }
              }
            }
          }
        }
      }
    },
    "/api/templates/import": {
      "post": {
        "tags": ["Templates"],
        "summary": "Import a machine template folder or zip file",
        "operationId": "importTemplate",
        "requestBody": {
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": { "type": "string", "format": "binary", "description": "Zip archive or template files" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Template imported successfully" },
          "400": { "$ref": "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/templates/{id}/drawing": {
      "get": {
        "tags": ["Templates"],
        "summary": "Get SVG drawing content for a template",
        "operationId": "getTemplateDrawing",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": {
            "description": "SVG content string",
            "content": { "image/svg+xml": { "schema": { "type": "string" } } }
          },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      }
    },
    "/api/images": {
      "get": {
        "tags": ["Images"],
        "summary": "List disk images in centralized storage (~/.netlabctl/images/)",
        "operationId": "listImages",
        "responses": {
          "200": {
            "description": "List of disk image filenames",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "type": "string" }
                }
              }
            }
          }
        }
      }
    },
    "/api/images/upload": {
      "post": {
        "tags": ["Images"],
        "summary": "Upload a disk image file (.qcow2, .raw, .img)",
        "operationId": "uploadImage",
        "requestBody": {
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "file": { "type": "string", "format": "binary" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Disk image uploaded successfully" },
          "400": { "$ref": "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/projects": {
      "get": {
        "tags": ["Projects"],
        "summary": "List all topology projects",
        "operationId": "listProjects",
        "responses": {
          "200": {
            "description": "List of project summaries",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/Topology" }
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": ["Projects"],
        "summary": "Create a new empty project topology",
        "operationId": "createProject",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": { "type": "string", "example": "My Lab" }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created project topology",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } } }
          }
        }
      }
    },
    "/api/projects/import": {
      "post": {
        "tags": ["Projects"],
        "summary": "Import a project topology JSON file",
        "operationId": "importProject",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } }
          }
        },
        "responses": {
          "200": { "description": "Project imported successfully" }
        }
      }
    },
    "/api/projects/{id}": {
      "get": {
        "tags": ["Projects"],
        "summary": "Get project topology details by ID",
        "operationId": "getProject",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } } } },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      },
      "put": {
        "tags": ["Projects"],
        "summary": "Update project topology (nodes, wires, configuration)",
        "operationId": "updateProject",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } } }
        },
        "responses": {
          "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } } } }
        }
      },
      "delete": {
        "tags": ["Projects"],
        "summary": "Delete a project topology and its node files from disk",
        "operationId": "deleteProject",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "240": { "description": "Project deleted successfully" }
        }
      }
    },
    "/api/projects/{id}/clone": {
      "post": {
        "tags": ["Projects"],
        "summary": "Clone an existing project topology",
        "operationId": "cloneProject",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": { "type": "string", "example": "My Lab (Copy)" }
                }
              }
            }
          }
        },
        "responses": {
          "201": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } } } }
        }
      }
    },
    "/api/projects/{id}/nodes": {
      "post": {
        "tags": ["Nodes"],
        "summary": "Add a new node instance to project topology",
        "operationId": "addNode",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "templateId": { "type": "string" },
                  "name": { "type": "string" },
                  "x": { "type": "number" },
                  "y": { "type": "number" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Topology" } } } }
        }
      }
    },
    "/api/projects/{id}/start": {
      "post": {
        "tags": ["Simulation"],
        "summary": "Start simulation for all machines in project",
        "operationId": "startSimulation",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Simulation started" }
        }
      }
    },
    "/api/projects/{id}/stop": {
      "post": {
        "tags": ["Simulation"],
        "summary": "Stop lab simulation (first click sends ACPI shutdown via QMP, force=true hard stops)",
        "operationId": "stopSimulation",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "force", "in": "query", "required": false, "schema": { "type": "boolean", "default": false }, "description": "Set true to immediately terminate all QEMU processes" }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "force": { "type": "boolean", "default": false }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Simulation stopping or stopped" }
        }
      }
    },
    "/api/projects/{id}/nodes/{nodeId}/start": {
      "post": {
        "tags": ["Nodes"],
        "summary": "Power ON a single node instance",
        "operationId": "startNode",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Node started" }
        }
      }
    },
    "/api/projects/{id}/nodes/{nodeId}/shutdown": {
      "post": {
        "tags": ["Nodes"],
        "summary": "Send ACPI powerdown signal via QMP monitor socket to single node",
        "operationId": "shutdownNode",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "ACPI shutdown signal sent" }
        }
      }
    },
    "/api/projects/{id}/nodes/{nodeId}/reset": {
      "post": {
        "tags": ["Nodes"],
        "summary": "Send system reset signal via QMP monitor socket to single node",
        "operationId": "resetNode",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Reset signal sent" }
        }
      }
    },
    "/api/projects/{id}/nodes/{nodeId}/stop": {
      "post": {
        "tags": ["Nodes"],
        "summary": "Hard stop (terminate) QEMU process for single node",
        "operationId": "stopNode",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Node process terminated" }
        }
      }
    },
    "/api/projects/{id}/nodes/{nodeId}/recreate-disk": {
      "post": {
        "tags": ["Nodes"],
        "summary": "Recreate fresh qcow2 disk overlay for single node",
        "operationId": "recreateDisk",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Disk overlay recreated" }
        }
      }
    },
    "/api/projects/{id}/nodes/{nodeId}": {
      "delete": {
        "tags": ["Nodes"],
        "summary": "Remove node instance from project topology",
        "operationId": "deleteNode",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "Node removed" }
        }
      }
    },
    "/ws": {
      "get": {
        "tags": ["WebSockets"],
        "summary": "Main WebSocket stream for project state events, telemetry, and actions",
        "operationId": "wsMainStream",
        "responses": {
          "101": { "description": "WebSocket connection upgraded" }
        }
      }
    },
    "/api/v1/projects/{id}/nodes/{nodeId}/terminal": {
      "get": {
        "tags": ["WebSockets"],
        "summary": "Interactive serial console WebSocket connection (xterm.js)",
        "operationId": "wsSerialTerminal",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "nodeId", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "101": { "description": "Serial terminal WebSocket upgraded" }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "MachineTemplate": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "image": { "type": "string" },
          "system": { "type": "string" },
          "memory": { "type": "integer" },
          "smp": { "type": "integer" },
          "userdata": { "type": "string" },
          "metadata": { "type": "string" },
          "imageExists": { "type": "boolean" },
          "ports": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "name": { "type": "string" }
              }
            }
          }
        }
      },
      "Topology": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "simulationStatus": { "type": "string", "enum": ["stopped", "running", "stopping"] },
          "nodes": { "type": "array", "items": { "$ref": "#/components/schemas/Node" } },
          "wires": { "type": "array", "items": { "$ref": "#/components/schemas/Wire" } }
        }
      },
      "Node": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "templateId": { "type": "string" },
          "name": { "type": "string" },
          "status": { "type": "string", "enum": ["stopped", "running", "stopping", "error"] },
          "power": { "type": "string", "enum": ["on", "off"] },
          "x": { "type": "number" },
          "y": { "type": "number" },
          "memory": { "type": "integer" },
          "smp": { "type": "integer" },
          "ports": { "type": "array", "items": { "$ref": "#/components/schemas/NodePort" } }
        }
      },
      "NodePort": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "mac": { "type": "string" },
          "type": { "type": "string", "enum": ["managed", "user", "bridge", "tap", "unmanaged"] },
          "linkState": { "type": "string", "enum": ["on", "off"] },
          "netdevDriver": { "type": "string" },
          "hostFwd": { "type": "string" },
          "bridgeIf": { "type": "string" },
          "tapIf": { "type": "string" }
        }
      },
      "Wire": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "srcNodeId": { "type": "string" },
          "srcPortId": { "type": "string" },
          "dstNodeId": { "type": "string" },
          "dstPortId": { "type": "string" },
          "tzspTarget": { "type": "string" },
          "conditions": { "$ref": "#/components/schemas/NetworkCondition" }
        }
      },
      "NetworkCondition": {
        "type": "object",
        "properties": {
          "delayMs": { "type": "integer" },
          "jitterMs": { "type": "integer" },
          "lossPercent": { "type": "number" }
        }
      }
    },
    "responses": {
      "BadRequest": {
        "description": "Invalid request payload or parameters"
      },
      "NotFound": {
        "description": "Requested resource not found"
      }
    }
  }
}
`
