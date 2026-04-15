import React, { useEffect, useState } from 'react';
import { api, API_BASE } from '../lib/api';

interface LibraryImage { name: string; url: string; }

interface Props {
  onSelect: (url: string) => void;
  onClose:  () => void;
}

export default function LibraryPicker({ onSelect, onClose }: Props) {
  const [images,  setImages]  = useState<LibraryImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.library.list()
      .then(setImages)
      .catch(() => setImages([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="lib-overlay" onClick={onClose}>
      <div className="lib-modal" onClick={e => e.stopPropagation()}>
        <div className="lib-header">
          <span style={{ fontWeight: 600, fontSize: 14 }}>Image Library</span>
          <button className="btn btn-sm btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="lib-empty">Loading…</div>
        )}

        {!loading && images.length === 0 && (
          <div className="lib-empty">
            No images in the library yet.<br />
            <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
              Add image files to <code>backend/library/</code> and redeploy — they&apos;ll persist forever.
            </span>
          </div>
        )}

        {!loading && images.length > 0 && (
          <div className="lib-grid">
            {images.map(img => (
              <button
                key={img.name}
                className="lib-thumb"
                title={img.name}
                onClick={() => { onSelect(img.url); onClose(); }}
              >
                <img src={`${API_BASE}${img.url}`} alt={img.name} />
                <span className="lib-thumb-name">{img.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
