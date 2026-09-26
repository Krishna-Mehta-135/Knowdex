"use client";

import { useEffect, useRef, useState } from "react";

const MIN_STEP = 3; // characters per frame when nothing is queued (~180 chars/s at 60fps)
const MAX_STEP = 60; // catch-up ceiling
const WORD_SNAP = 14; // finish the current word if its end is this close

/**
 * How far to reveal on the next frame. Speed scales with the backlog so a
 * model that delivers big chunks still reads as smooth typing, and the reveal
 * always ends on a word boundary (whole words appear, like ChatGPT).
 */
export function nextRevealIndex(text: string, shown: number): number {
  const remaining = text.length - shown;
  if (remaining <= 0) return text.length;
  const step = Math.max(
    MIN_STEP,
    Math.min(MAX_STEP, Math.round(remaining / 10)),
  );
  let target = Math.min(text.length, shown + step);
  if (target < text.length && !/\s/.test(text[target - 1] ?? " ")) {
    // mid-word: extend to the next whitespace if it is close
    const rest = text.slice(target, target + WORD_SNAP);
    const ws = rest.search(/\s/);
    if (ws >= 0) target += ws;
    else if (text.length - target <= WORD_SNAP) target = text.length;
  }
  return target;
}

/**
 * Progressive reveal of a growing string. Returns the visible prefix and
 * whether it is still catching up. Users who prefer reduced motion get the
 * text as it arrives.
 */
export function useTypewriter(
  text: string,
  enabled = true,
): { shown: string; typing: boolean } {
  const [count, setCount] = useState(0);
  const textRef = useRef(text);
  textRef.current = text;
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 16) return; // ~60fps cap
      last = now;
      setCount((c) => {
        const t = textRef.current;
        if (c > t.length) return t.length; // text was replaced by something shorter
        const n = nextRevealIndex(t, c);
        return n === c ? c : n;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!enabled || reduced.current) return { shown: text, typing: false };
  const n = Math.min(count, text.length);
  return { shown: text.slice(0, n), typing: n < text.length };
}
