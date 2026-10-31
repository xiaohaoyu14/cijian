import { useCallback, useLayoutEffect, useRef } from "react";

const pageOrder = ["today", "review-plan", "study", "decks", "exam", "stats", "settings"];

/** One incoming surface, without duplicating pages, remounting forms or delaying input. */
export function usePageMotion(page: string, loaded: boolean) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(page);
  const animation = useRef<Animation | undefined>(undefined);
  const cancel = useCallback(() => {
    animation.current?.cancel();
    animation.current = undefined;
  }, []);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = page;
    cancel();
    const el = ref.current;
    if (!loaded || !el || typeof el.animate !== "function") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const direction = pageOrder.indexOf(page) < pageOrder.indexOf(from) ? -1 : 1;
    animation.current = el.animate([
      { opacity: 0.65, transform: `translateX(${direction * 16}px)` },
      { opacity: 1, transform: "none" },
    ], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
    animation.current.id = "page-slide";
    // A preference change also stops an already running transition.
    const change = () => { if (reduced.matches) cancel(); };
    reduced.addEventListener("change", change);
    return () => { reduced.removeEventListener("change", change); cancel(); };
  }, [page, loaded, cancel]);

  return { ref, cancel };
}
