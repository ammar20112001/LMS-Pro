import { useState } from "react";
import { Item } from "../api/client";

interface Props {
  item: Item;
}

export function FileViewer({ item }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewUrl = `http://localhost:8000/api/items/${item.id}/file/view`;
  const downloadUrl = `http://localhost:8000/api/items/${item.id}/file`;

  function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        style={{
          display: "inline-block",
          marginTop: 8,
          fontSize: 11,
          fontWeight: 600,
          color: "#4f46e5",
          background: "#ede9fe",
          padding: "4px 10px",
          borderRadius: 4,
          border: "none",
          cursor: "pointer",
        }}
      >
        📄 View File
      </button>

      {open && (
        <div
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 40,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              width: "min(860px, 94vw)",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 20px",
                borderBottom: "1px solid #e5e7eb",
                flexShrink: 0,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  {item.course_code} · Assignment File
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  href={downloadUrl}
                  download
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#374151",
                    background: "#f3f4f6",
                    padding: "5px 12px",
                    borderRadius: 4,
                    textDecoration: "none",
                  }}
                >
                  ↓ Download .docx
                </a>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 20,
                    color: "#9ca3af",
                    lineHeight: 1,
                    padding: "2px 4px",
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
              {loading && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    color: "#6b7280",
                    fontSize: 13,
                    background: "#fff",
                    zIndex: 1,
                  }}
                >
                  <div style={{
                    width: 32, height: 32, border: "3px solid #e5e7eb",
                    borderTopColor: "#4f46e5", borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }} />
                  Fetching file from LMS…
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>
                    First load launches a browser — takes ~20 seconds
                  </span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}

              {error && (
                <div style={{ padding: 40, textAlign: "center", color: "#dc2626" }}>
                  {error}
                </div>
              )}

              <iframe
                src={viewUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: 500,
                  border: "none",
                  display: "block",
                }}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError("Failed to load file. The LMS session may have expired — try syncing first.");
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
