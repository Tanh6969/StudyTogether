import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePresentationSync } from '../../../hooks/usePresentationSync';
import { getWhiteboardAssetDownloadUrl } from '../../../lib/whiteboardAsset.api';
import { loadPdfDocument } from '../../../lib/pdf';
import type { PresentationState } from '../../../lib/studyRoom.types';
import { getPresentationFitScale } from './presentationLayout';

interface PresentationViewerProps {
  roomId: string;
  initialState: PresentationState | null;
  isReadonly: boolean;
}

export function PresentationViewer({ roomId, initialState, isReadonly }: PresentationViewerProps) {
  const { presentation, isUploading, uploadError, canControl, uploadDeck, goToPage, clearDeck } =
    usePresentationSync(roomId, initialState, isReadonly);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadedDoc, setLoadedDoc] = useState<{ path: string; doc: PDFDocumentProxy } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Mirrors `loadedDoc` for reading the previous value inside the effect below without adding
  // it as a dependency (which would re-trigger the effect every time the effect itself calls
  // setLoadedDoc) -- a plain ref, not a functional setState updater, so the actual
  // `.destroy()` cleanup call stays outside React's render/update cycle (a setState updater
  // can run more than once, e.g. under StrictMode, and must stay pure).
  const loadedDocRef = useRef<typeof loadedDoc>(null);
  loadedDocRef.current = loadedDoc;

  // Load (and cache) the PDF document whenever the shared deck itself changes -- not on every
  // page turn, which only needs to re-render from the already-loaded document below.
  useEffect(() => {
    if (!presentation) {
      if (loadedDocRef.current) {
        loadedDocRef.current.doc.loadingTask.destroy();
        setLoadedDoc(null);
      }
      return;
    }
    if (loadedDocRef.current?.path === presentation.asset_path) return;

    let cancelled = false;
    setRenderError(null);
    (async () => {
      try {
        const { url } = await getWhiteboardAssetDownloadUrl(roomId, presentation.asset_path);
        const doc = await loadPdfDocument(url);
        if (cancelled) {
          doc.loadingTask.destroy();
          return;
        }
        loadedDocRef.current?.doc.loadingTask.destroy();
        setLoadedDoc({ path: presentation.asset_path, doc });
      } catch (err) {
        console.error('Failed to load presentation deck', err);
        if (!cancelled) setRenderError('Không thể tải slide bài giảng.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presentation, roomId]);

  // Destroy whatever's cached when the viewer itself unmounts (e.g. switching back to the
  // whiteboard tab).
  useEffect(() => {
    return () => {
      loadedDocRef.current?.doc.loadingTask.destroy();
    };
  }, []);

  useEffect(() => {
    if (!presentation) return;
    const container = pageContainerRef.current;
    if (!container) return;

    const updateSize = (width: number, height: number) => {
      setContainerSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    };
    const bounds = container.getBoundingClientRect();
    updateSize(bounds.width, bounds.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [!!presentation]);

  // Render the current page onto the canvas.
  useEffect(() => {
    if (!loadedDoc || !presentation || containerSize.width <= 0 || containerSize.height <= 0) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    (async () => {
      try {
        const page = await loadedDoc.doc.getPage(presentation.page);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = getPresentationFitScale(
          baseViewport.width,
          baseViewport.height,
          containerSize.width,
          containerSize.height
        );
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const renderTask = page.render({ canvas, viewport });
        cancelRender = () => renderTask.cancel();
        await renderTask.promise;
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to render presentation page', err);
        setRenderError('Không thể hiển thị trang slide này.');
      }
    })();
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [loadedDoc, presentation, containerSize]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadDeck(file);
  };

  if (!presentation) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: '#64748B',
        }}
      >
        <p style={{ margin: 0, fontSize: 14 }}>
          {canControl ? 'Chưa có slide nào được chia sẻ.' : 'Người chủ trì chưa chia sẻ slide bài giảng nào.'}
        </p>
        {canControl && (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: isUploading ? '#94A3B8' : '#2563EB',
              color: 'white',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: isUploading ? 'default' : 'pointer',
            }}
          >
            {isUploading ? 'Đang tải lên...' : 'Tải lên slide bài giảng (PDF)'}
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={isUploading}
              style={{ display: 'none' }}
            />
          </label>
        )}
        {uploadError && <p style={{ margin: 0, color: '#DC2626', fontSize: 13 }}>{uploadError}</p>}
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 20,
      }}
    >
      <div
        ref={pageContainerRef}
        style={{ flex: 1, width: '100%', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', boxShadow: '0 8px 20px rgba(0,0,0,0.08)', background: 'white' }}
        />
      </div>
      {(renderError || uploadError) && (
        <p style={{ margin: 0, color: '#DC2626', fontSize: 13 }}>{renderError ?? uploadError}</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => goToPage(presentation.page - 1)}
          disabled={!canControl || presentation.page <= 1}
          style={navButtonStyle}
        >
          ‹ Trước
        </button>
        <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>
          Trang {presentation.page} / {presentation.page_count}
        </span>
        <button
          onClick={() => goToPage(presentation.page + 1)}
          disabled={!canControl || presentation.page >= presentation.page_count}
          style={navButtonStyle}
        >
          Sau ›
        </button>
        {canControl && (
          <button onClick={clearDeck} style={{ ...navButtonStyle, color: '#DC2626', borderColor: '#FCA5A5' }}>
            Xóa slide
          </button>
        )}
      </div>
    </div>
  );
}

const navButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid #CBD5E1',
  background: 'white',
  color: '#334155',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
