import {
  AlertCircle,
  Bug,
  CheckCircle2,
  FileArchive,
  HardDrive,
  Loader2,
  Settings,
  UploadCloud,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { importTemplateZip, uploadDiskImage } from "../services/api";

export function SettingsModal({ isOpen, onClose, config, onUpdateConfig, onImportSuccess }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);

  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadStatus, setImageUploadStatus] = useState(null);

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  if (!isOpen) return null;

  const handleImageUpload = async (file) => {
    if (!file) return;
    setIsUploadingImage(true);
    setImageUploadStatus(null);

    try {
      const res = await uploadDiskImage(file);
      setIsUploadingImage(false);
      setImageUploadStatus({
        type: "success",
        message: `Disk image ${res.filename} uploaded successfully to ~/.netlabctl/images`,
      });
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (err) {
      setIsUploadingImage(false);
      setImageUploadStatus({
        type: "error",
        message: err.message || "Failed to upload disk image.",
      });
    }
  };

  const handleProcessFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setUploadStatus({
        type: "error",
        message: "Only .zip files are supported for device template import.",
      });
      return;
    }

    setIsUploading(true);
    setUploadStatus(null);

    try {
      const res = await importTemplateZip(file);
      setIsUploading(false);
      setUploadStatus({
        type: "success",
        message: res.message || "Template archive imported successfully!",
      });
      if (onImportSuccess) {
        onImportSuccess(res.templates);
      }
    } catch (err) {
      setIsUploading(false);
      setUploadStatus({
        type: "error",
        message: err.message || "Failed to import template archive.",
      });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && onClose()}
      role="button"
      tabIndex={0}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
        style={{
          width: "520px",
          maxWidth: "90vw",
          maxHeight: "85vh",
          background: "var(--bg-card)",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Settings size={20} className="text-blue-500" />
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Application Settings</h3>
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px" }}
            onClick={onClose}
            aria-label="Close Settings"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Section: Debugging & Inspection */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Debugging & Display
          </div>

          <div
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <Bug size={20} style={{ color: "#38bdf8", marginTop: "2px", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>
                  Show Debug HUD
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "2px" }}>
                  Displays the canvas Port Inspector Debug HUD (hover telemetry, port coordinates,
                  target hits).
                </div>
              </div>
            </div>

            <input
              type="checkbox"
              checked={config?.showDebugHud !== false}
              onChange={(e) =>
                onUpdateConfig({
                  ...config,
                  showDebugHud: e.target.checked,
                })
              }
              style={{
                cursor: "pointer",
                accentColor: "#38bdf8",
                width: "18px",
                height: "18px",
                flexShrink: 0,
              }}
            />
          </div>

          {/* Section: Import Device Templates */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginTop: "8px",
            }}
          >
            Device Templates
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".zip"
            style={{ display: "none" }}
          />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            style={{
              background: isDragging ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
              border: isDragging ? "2px dashed #38bdf8" : "2px dashed var(--border-color)",
              borderRadius: "8px",
              padding: "24px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {isUploading ? (
              <>
                <Loader2
                  size={32}
                  style={{ color: "#38bdf8", animation: "spin 1s linear infinite" }}
                />
                <div style={{ fontSize: "0.9rem", color: "var(--text-main)", fontWeight: 500 }}>
                  Extracting & Importing Template ZIP...
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    background: "rgba(56, 189, 248, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <UploadCloud size={24} style={{ color: "#38bdf8" }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "0.9rem", color: "var(--text-main)", fontWeight: 600 }}>
                    Drag & Drop Device Template ZIP
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
                    or{" "}
                    <span style={{ color: "#38bdf8", textDecoration: "underline" }}>
                      browse files
                    </span>{" "}
                    on your machine
                  </div>
                </div>
                <div
                  style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}
                >
                  Extracts template files into{" "}
                  <code
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      padding: "2px 4px",
                      borderRadius: "3px",
                    }}
                  >
                    ~/.netlabctl/devices
                  </code>
                </div>
              </>
            )}
          </div>

          {uploadStatus && (
            <div
              style={{
                background:
                  uploadStatus.type === "success"
                    ? "rgba(34, 197, 94, 0.15)"
                    : "rgba(239, 68, 68, 0.15)",
                border: `1px solid ${
                  uploadStatus.type === "success"
                    ? "rgba(34, 197, 94, 0.4)"
                    : "rgba(239, 68, 68, 0.4)"
                }`,
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "0.85rem",
                color: uploadStatus.type === "success" ? "#4ade80" : "#f87171",
              }}
            >
              {uploadStatus.type === "success" ? (
                <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              ) : (
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>{uploadStatus.message}</div>
            </div>
          )}

          {/* Section: Upload Disk Images */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginTop: "12px",
            }}
          >
            Disk Images (~/.netlabctl/images)
          </div>

          <input
            type="file"
            ref={imageInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleImageUpload(e.target.files[0]);
              }
            }}
            accept=".qcow2,.img,.iso,.vmdk,.raw,.bin"
            style={{ display: "none" }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingImage(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDraggingImage(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingImage(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleImageUpload(e.dataTransfer.files[0]);
              }
            }}
            onClick={() => imageInputRef.current?.click()}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && imageInputRef.current?.click()
            }
            role="button"
            tabIndex={0}
            style={{
              background: isDraggingImage ? "rgba(168, 85, 247, 0.15)" : "rgba(15, 23, 42, 0.6)",
              border: isDraggingImage ? "2px dashed #a855f7" : "2px dashed var(--border-color)",
              borderRadius: "8px",
              padding: "20px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {isUploadingImage ? (
              <>
                <Loader2
                  size={28}
                  style={{ color: "#a855f7", animation: "spin 1s linear infinite" }}
                />
                <div style={{ fontSize: "0.85rem", color: "var(--text-main)", fontWeight: 500 }}>
                  Uploading Disk Image to ~/.netlabctl/images...
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: "rgba(168, 85, 247, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HardDrive size={22} style={{ color: "#a855f7" }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-main)", fontWeight: 600 }}>
                    Upload QCOW2 / Disk Image File
                  </div>
                  <div
                    style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}
                  >
                    Select or drag{" "}
                    <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 3px" }}>
                      .qcow2
                    </code>
                    ,{" "}
                    <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 3px" }}>.img</code>,{" "}
                    <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 3px" }}>.iso</code>{" "}
                    to store in{" "}
                    <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 3px" }}>
                      ~/.netlabctl/images
                    </code>
                  </div>
                </div>
              </>
            )}
          </div>

          {imageUploadStatus && (
            <div
              style={{
                background:
                  imageUploadStatus.type === "success"
                    ? "rgba(34, 197, 94, 0.15)"
                    : "rgba(239, 68, 68, 0.15)",
                border: `1px solid ${
                  imageUploadStatus.type === "success"
                    ? "rgba(34, 197, 94, 0.4)"
                    : "rgba(239, 68, 68, 0.4)"
                }`,
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "0.85rem",
                color: imageUploadStatus.type === "success" ? "#4ade80" : "#f87171",
              }}
            >
              {imageUploadStatus.type === "success" ? (
                <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              ) : (
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>{imageUploadStatus.message}</div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
