import { useState } from "react";
import { Item } from "../api/client";

interface Props {
  item: Item;
}

export function FileViewer({ item }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const viewUrl = `http://localhost:8000/api/items/${item.id}/file/view`;
  const downloadUrl = `http://localhost:8000/api/items/${item.id}/file`;

  return (
    <>
      <button
        onClick={() => { setOpen(true); setLoading(true); }}
        className="btn-file"
        style={{ marginTop: 8, fontSize: 11 }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1h5.5l2.5 2.5V10a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V1.5A.5.5 0 012 1z" stroke="currentColor" strokeWidth="1.2"/></svg>
        View File
      </button>

      {open && (
        <div
          className="fv-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="fv-modal">
            <div className="fv-modal__header">
              <div>
                <div className="fv-modal__title">{item.title}</div>
                <div className="fv-modal__sub">{item.course_code} · Assignment File</div>
              </div>
              <div className="fv-modal__actions">
                <a href={downloadUrl} download className="fv-modal__dl">↓ Download .docx</a>
                <button className="fv-modal__close" onClick={() => setOpen(false)}>×</button>
              </div>
            </div>

            <div className="fv-modal__body">
              {loading && (
                <div className="fv-modal__loading">
                  <div className="fv-modal__spinner" />
                  Fetching file from LMS…
                  <span className="fv-modal__hint">First load launches a browser — takes ~20 seconds</span>
                </div>
              )}
              <iframe
                src={viewUrl}
                style={{ width: "100%", height: "100%", minHeight: 500, border: "none", display: "block" }}
                onLoad={() => setLoading(false)}
                onError={() => setLoading(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
