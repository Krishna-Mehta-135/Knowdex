"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Heading {
  level: number;
  text: string;
  pos: number;
}

/**
 * "On this page" rail for long notes: headings with scroll-spy. Only shown on
 * wide screens and when there are at least two headings.
 */
export function EditorOutline({
  editor,
  scrollRef,
}: {
  editor: Editor | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<number | null>(null);
  // Needs the 768px column plus the rail on the right; measure the real container.
  const [roomy, setRoomy] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoomy(el.clientWidth >= 1180));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const list: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.textContent.trim()) {
          list.push({
            level: Number(node.attrs.level) || 1,
            text: node.textContent.trim(),
            pos,
          });
        }
      });
      setHeadings((prev) =>
        prev.length === list.length &&
        prev.every(
          (p, i) =>
            p.text === list[i]!.text &&
            p.pos === list[i]!.pos &&
            p.level === list[i]!.level,
        )
          ? prev
          : list,
      );
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 300);
    };
    read();
    editor.on("update", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", schedule);
    };
  }, [editor]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !editor || headings.length < 2) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 120;
      let current: number | null = null;
      for (const h of headings) {
        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        if (dom && dom.getBoundingClientRect().top <= top) current = h.pos;
      }
      setActive(current);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [headings, editor, scrollRef]);

  if (!editor || !roomy || headings.length < 2) return null;
  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <nav
      aria-label="Outline"
      className="absolute bottom-0 left-full top-0 ml-8 w-44"
    >
      <div className="sticky top-8">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
          On this page
        </p>
        <ul className="space-y-0.5 border-l border-[hsl(var(--sb-border))]">
          {headings.map((h) => (
            <li key={h.pos}>
              <button
                onClick={() => {
                  const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
                  dom?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                style={{ paddingLeft: 10 + (h.level - minLevel) * 10 }}
                className={`-ml-px block w-full truncate border-l py-1 pr-2 text-left text-xs transition-colors ${
                  active === h.pos
                    ? "border-[hsl(var(--sb-accent))] text-white"
                    : "border-transparent text-[hsl(var(--sb-text-muted))] hover:text-white"
                }`}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
