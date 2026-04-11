import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { AspectRatio } from '../../types';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  aspectRatio: AspectRatio;
  numSlides: number;
  renderSlideForPreview: (slideIndex: number, targetWidth: number) => string | null;
}

export function PreviewModal({
  isOpen,
  onClose,
  aspectRatio,
  numSlides,
  renderSlideForPreview,
}: PreviewModalProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [trackX, setTrackX] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, trackX: 0 });
  const trackXRef = useRef(0);

  // Phone frame: 9:19.5 iPhone-like aspect ratio, 75% of viewport height
  const phoneHeight = Math.round(window.innerHeight * 0.75);
  const phoneWidth = Math.round(phoneHeight * (9 / 19.5));

  // Render at the display's native pixel density for the phone width
  const renderTargetWidth = useMemo(
    () => Math.round(phoneWidth * (window.devicePixelRatio || 1)),
    [phoneWidth]
  );

  // Measure image container after mount
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      if (imageContainerRef.current) {
        setMeasuredWidth(imageContainerRef.current.clientWidth);
      }
    });
  }, [isOpen]);

  const slideWidth = measuredWidth || phoneWidth;

  // Async slide rendering — one slide per animation frame so UI stays responsive
  const [slideImages, setSlideImages] = useState<(string | null)[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    // Reset carousel state
    setCurrentSlide(0);
    setTrackX(0);
    trackXRef.current = 0;
    setIsAnimating(false);

    // Render slides progressively
    let cancelled = false;
    const images: (string | null)[] = new Array(numSlides).fill(null);
    setSlideImages(images);

    let index = 0;
    const renderNext = () => {
      if (cancelled || index >= numSlides) return;
      images[index] = renderSlideForPreview(index, renderTargetWidth);
      index++;
      if (!cancelled) {
        setSlideImages([...images]);
        if (index < numSlides) {
          requestAnimationFrame(renderNext);
        }
      }
    };

    requestAnimationFrame(renderNext);

    return () => {
      cancelled = true;
    };
  }, [isOpen, numSlides, renderSlideForPreview, renderTargetWidth]);

  const snapToSlide = useCallback(
    (target: number) => {
      target = Math.max(0, Math.min(numSlides - 1, target));
      const newX = -target * slideWidth;
      trackXRef.current = newX;
      setIsAnimating(true);
      setTrackX(newX);
      setCurrentSlide(target);
    },
    [numSlides, slideWidth]
  );

  // Stable refs for keyboard handler — avoids re-attaching listener on every scroll
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const snapToSlideRef = useRef(snapToSlide);
  snapToSlideRef.current = snapToSlide;
  const currentSlideRef = useRef(currentSlide);
  currentSlideRef.current = currentSlide;

  // Keyboard navigation — single listener attached on open, never re-runs during scrolling
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'ArrowLeft') snapToSlideRef.current(currentSlideRef.current - 1);
      if (e.key === 'ArrowRight') snapToSlideRef.current(currentSlideRef.current + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Mouse drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (numSlides <= 1) return;
      dragStartRef.current = { x: e.clientX, trackX: trackXRef.current };
      setIsDragging(true);
      setIsAnimating(false);
      e.preventDefault();
    },
    [numSlides]
  );

  // Mouse drag move/up (only attached while dragging, per MEMORY.md guidance)
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      let newX = dragStartRef.current.trackX + dx;

      // Rubber-band at edges
      const minX = -(numSlides - 1) * slideWidth;
      if (newX > 0) newX *= 0.3;
      else if (newX < minX) newX = minX + (newX - minX) * 0.3;

      trackXRef.current = newX;
      setTrackX(newX);
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      if (slideWidth === 0) return;

      const dx = e.clientX - dragStartRef.current.x;
      const threshold = slideWidth * 0.15;
      const currentPos = -trackXRef.current / slideWidth;

      let target: number;
      if (dx < -threshold) target = Math.ceil(currentPos);
      else if (dx > threshold) target = Math.floor(currentPos);
      else target = Math.round(currentPos);

      snapToSlide(target);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, numSlides, slideWidth, snapToSlide]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
    >
      <div className="relative">
        {/* Close button — floating outside the frame */}
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-600 transition-colors shadow-lg"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Phone frame */}
        <div
          className="bg-black rounded-[2rem] overflow-hidden flex flex-col border border-gray-700/60 shadow-2xl"
          style={{ width: phoneWidth, height: phoneHeight }}
        >
          {/* Status bar */}
          <div className="flex items-center justify-between px-6 pt-3 pb-1 text-white text-xs flex-shrink-0">
            <span className="font-semibold">9:41</span>
            <div className="flex items-center gap-1.5">
              {/* Signal */}
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="1" y="14" width="4" height="8" rx="1" />
                <rect x="7" y="10" width="4" height="12" rx="1" />
                <rect x="13" y="6" width="4" height="16" rx="1" />
                <rect x="19" y="2" width="4" height="20" rx="1" />
              </svg>
              {/* WiFi */}
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 00-6 0zm-4-4l2 2a7.074 7.074 0 0110 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
              </svg>
              {/* Battery */}
              <svg className="w-5 h-4" viewBox="0 0 28 14" fill="currentColor">
                <rect x="0.5" y="0.5" width="23" height="13" rx="3" stroke="currentColor" strokeWidth="1" fill="none" />
                <rect x="25" y="4" width="2.5" height="6" rx="1" />
                <rect x="2" y="2" width="14" height="9.5" rx="1.5" />
              </svg>
            </div>
          </div>

          {/* Post header — avatar & username */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 p-[2px]">
              <div className="w-full h-full rounded-full bg-gray-800 flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <span className="text-white text-sm font-semibold">username</span>
            </div>
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </div>

          {/* Image carousel area */}
          <div
            ref={imageContainerRef}
            className="relative overflow-hidden flex-shrink-0"
            style={{ aspectRatio: `${aspectRatio.width} / ${aspectRatio.height}` }}
          >
            {/* Slide track */}
            <div
              className="flex h-full"
              style={{
                transform: `translateX(${trackX}px)`,
                transition: isAnimating
                  ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
                  : 'none',
                cursor:
                  numSlides > 1
                    ? isDragging
                      ? 'grabbing'
                      : 'grab'
                    : 'default',
                userSelect: 'none',
              }}
              onTransitionEnd={() => setIsAnimating(false)}
              onMouseDown={handleMouseDown}
            >
              {slideImages.map((src, i) => (
                <div
                  key={i}
                  className="h-full flex-shrink-0"
                  style={{ width: slideWidth }}
                >
                  {src ? (
                    <img
                      src={src}
                      alt={`Slide ${i + 1}`}
                      className="w-full h-full object-cover pointer-events-none"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
                      Slide {i + 1}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Left arrow */}
            {numSlides > 1 && currentSlide > 0 && !isDragging && (
              <button
                onClick={() => snapToSlide(currentSlide - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center transition-colors shadow-md"
              >
                <svg className="w-4 h-4 text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}

            {/* Right arrow */}
            {numSlides > 1 && currentSlide < numSlides - 1 && !isDragging && (
              <button
                onClick={() => snapToSlide(currentSlide + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center transition-colors shadow-md"
              >
                <svg className="w-4 h-4 text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* Slide counter badge */}
            {numSlides > 1 && (
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-medium backdrop-blur-sm pointer-events-none">
                {currentSlide + 1}/{numSlides}
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0">
            <div className="flex items-center gap-4">
              {/* Heart */}
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {/* Comment */}
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {/* Share / Send */}
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </div>
            {/* Bookmark */}
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </div>

          {/* Dot indicators */}
          {numSlides > 1 && (
            <div className="flex items-center justify-center gap-1.5 pb-2 flex-shrink-0">
              {Array.from({ length: numSlides }, (_, i) => (
                <button
                  key={i}
                  onClick={() => snapToSlide(i)}
                  className={`rounded-full transition-all duration-200 ${
                    i === currentSlide
                      ? 'w-[6px] h-[6px] bg-blue-500'
                      : 'w-[6px] h-[6px] bg-gray-600 hover:bg-gray-400'
                  }`}
                />
              ))}
            </div>
          )}

          {/* Caption area */}
          <div className="px-4 pt-0.5 pb-2 flex-shrink-0">
            <div className="flex gap-1.5">
              <span className="text-white text-sm font-semibold">username</span>
              <span className="text-gray-500 text-sm">Your caption here...</span>
            </div>
          </div>

          {/* Spacer to push content up — remaining phone space is black */}
          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
}
