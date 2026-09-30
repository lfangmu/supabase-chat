'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { useSignedUrl } from '@/hooks/useSignedUrl';

interface LightboxApi {
  open: (url: string) => void;
}

const LightboxContext = createContext<LightboxApi>({ open: () => {} });

export const useLightbox = (): LightboxApi => useContext(LightboxContext);

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.5;

export function LightboxProvider({
  images,
  children,
}: {
  images: string[];
  children: React.ReactNode;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const open = useCallback(
    (url: string) => {
      if (images.length === 0) return;
      const i = images.indexOf(url);
      setIndex(i >= 0 ? i : 0);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    },
    [images]
  );

  const close = useCallback(() => setIndex(null), []);

  const goPrev = useCallback(() => {
    setIndex((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i === null ? i : (i + 1) % images.length));
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [images.length]);

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, +(s + ZOOM_STEP).toFixed(2))),
    []
  );
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, +(s - ZOOM_STEP).toFixed(2))),
    []
  );

  const isOpen = index !== null;
  const current = index !== null ? images[index] ?? '' : '';
  const signedUrl = useSignedUrl(current);

  // Save image: open in new tab so user can long-press to save (works in WebView)
  const handleSave = useCallback(() => {
    if (signedUrl) {
      // P3：补 `noopener,noreferrer` —— 否则新窗口能通过 `window.opener` 反向操作本页
      // （反向 tabnabbing）。同文件其它外链与 TextMessage 已用 rel="noopener noreferrer"。
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    }
  }, [signedUrl]);

  // Keyboard navigation + body scroll lock while open
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, close, goPrev, goNext]);

  // Drag-to-pan (only meaningful when zoomed in)
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return;
      dragState.current = { x: e.clientX, y: e.clientY, px: position.x, py: position.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [scale, position]
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.x;
    const dy = e.clientY - dragState.current.y;
    setPosition({ x: dragState.current.px + dx, y: dragState.current.py + dy });
  }, []);
  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center overflow-hidden"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          {/* Close */}
          <button
            ref={closeBtnRef}
            onClick={close}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="关闭预览"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter */}
          {images.length > 1 && (
            <div className="absolute top-4 left-4 z-10 px-3 py-1 rounded-full bg-white/10 text-white text-sm tabular-nums">
              {(index as number) + 1} / {images.length}
            </div>
          )}

          {/* Prev / Next */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="上一张"
              >
                <ChevronLeft className="w-7 h-7" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="下一张"
              >
                <ChevronRight className="w-7 h-7" />
              </button>
            </>
          )}

          {/* Zoom controls + save */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2 py-1 rounded-full bg-white/10 text-white">
            <button
              onClick={(e) => {
                e.stopPropagation();
                zoomOut();
              }}
              disabled={scale <= MIN_SCALE}
              className="p-2 hover:bg-white/20 rounded-full disabled:opacity-40 transition-colors"
              aria-label="缩小"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-xs w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                zoomIn();
              }}
              disabled={scale >= MAX_SCALE}
              className="p-2 hover:bg-white/20 rounded-full disabled:opacity-40 transition-colors"
              aria-label="放大"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="w-px h-5 bg-white/20 mx-0.5" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSave();
              }}
              className="p-2 hover:bg-white/20 rounded-full transition-colors"
              aria-label="保存图片"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>

          {/* Image stage */}
          <div
            className="relative w-full h-full flex items-center justify-center p-4 sm:p-10"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ cursor: scale > 1 ? 'grab' : 'default', touchAction: 'none' }}
          >
            {signedUrl ? (
              <div
                className="relative w-full h-full"
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transition: dragState.current ? 'none' : 'transform 0.15s ease-out',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signedUrl}
                  alt="预览图片"
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-contain select-none rounded-lg shadow-2xl"
                />
              </div>
            ) : (
              <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            )}
          </div>
        </div>
      )}
    </LightboxContext.Provider>
  );
}

LightboxProvider.displayName = 'LightboxProvider';

export default LightboxProvider;
