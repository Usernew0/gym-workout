import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface HorizontalScrollWrapperProps {
  children: React.ReactNode;
  className?: string;
  scrollContainerClassName?: string;
  showButtons?: boolean;
  scrollAmount?: number;
}

export const HorizontalScrollWrapper: React.FC<HorizontalScrollWrapperProps> = ({
  children,
  className = '',
  scrollContainerClassName = '',
  showButtons = true,
  scrollAmount = 200
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    
    // Check if scrollable
    const scrollLeft = el.scrollLeft;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;

    // Small threshold for rounding issues
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft < maxScrollLeft - 2);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    checkScroll();

    // Attach scroll listener
    el.addEventListener('scroll', checkScroll, { passive: true });

    // Attach ResizeObserver to recheck on container/window resize or tab changes
    const resizeObserver = new ResizeObserver(() => {
      checkScroll();
    });
    resizeObserver.observe(el);

    // Also observe children mutations if child list updates
    const mutationObserver = new MutationObserver(() => {
      checkScroll();
    });
    mutationObserver.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener('scroll', checkScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [checkScroll]);

  const handleScrollLeft = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: -scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleScrollRight = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className={`relative group/scroll-wrap max-w-full ${className}`}>
      {/* LEFT SCROLL ARROW & GRADIENT FADE */}
      {canScrollLeft && (
        <>
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-neutral-950/80 to-transparent z-20 pointer-events-none rounded-l-2xl" />
          {showButtons && (
            <button
              onClick={handleScrollLeft}
              type="button"
              className="absolute left-1 top-1/2 -translate-y-1/2 z-30 p-1.5 rounded-full bg-neutral-900/90 text-rose-300 border border-white/20 hover:bg-rose-600 hover:text-white shadow-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </>
      )}

      {/* SCROLLABLE CONTENT CONTAINER */}
      <div
        ref={containerRef}
        className={`overflow-x-auto no-scrollbar scroll-smooth flex items-center ${scrollContainerClassName}`}
      >
        {children}
      </div>

      {/* RIGHT SCROLL ARROW & GRADIENT FADE */}
      {canScrollRight && (
        <>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-neutral-950/80 to-transparent z-20 pointer-events-none rounded-r-2xl" />
          {showButtons && (
            <button
              onClick={handleScrollRight}
              type="button"
              className="absolute right-1 top-1/2 -translate-y-1/2 z-30 p-1.5 rounded-full bg-neutral-900/90 text-rose-300 border border-white/20 hover:bg-rose-600 hover:text-white shadow-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-4 h-4 animate-pulse" />
            </button>
          )}
        </>
      )}
    </div>
  );
};
