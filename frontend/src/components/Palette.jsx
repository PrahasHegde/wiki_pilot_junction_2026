// ⌘K command palette: jump to an article, ask a question, or switch view — from anywhere.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Clock, Globe2, Home, Info, MessageCircleQuestion, Swords, CornerDownLeft } from "lucide-react";
import { useApp } from "../store";
import { useSuggest } from "./shell";
import { looksLikeQuestion, nf } from "../lib";

const VIEWS = [
  ["home", "Main page", Home], ["ask", "Ask Wikipedia", MessageCircleQuestion], ["machine", "Time machine", Clock],
  ["radar", "Edit wars", Swords], ["lens", "Language lens", Globe2], ["how", "How it works", Info],
];

export default function Palette({ open, onClose }) {
  const { go, setAt } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const pages = useSuggest(q, 6);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);

  const items = useMemo(() => {
    const t = q.trim(), out = [];
    const year = t.match(/^(?:go to |as of )?((?:19|20)\d\d)$/i);
    if (year) out.push({ icon: Clock, label: `Travel to ${year[1]}`, hint: "time bar", run: () => setAt(Date.UTC(+year[1], 6, 1)) });
    const askItem = t.length > 2 && { icon: MessageCircleQuestion, label: `Ask: “${t}”`, hint: "grounded answer", run: () => go(`ask/${encodeURIComponent(t)}`) };
    const pageItems = pages.map((p) => ({ icon: BookOpen, label: p.title, hint: `${nf(p.versions)} versions`, run: () => go(`machine/${p.page_id}`) }));
    // A name opens the article; a question asks.
    if (askItem && (looksLikeQuestion(t) || !pageItems.length)) out.push(askItem, ...pageItems);
    else out.push(...pageItems, ...(askItem ? [askItem] : []));
    if (pages[0]) out.push({ icon: Globe2, label: `Compare languages: ${pages[0].title}`, hint: "fi · sv · en", run: () => go(`lens/${pages[0].page_id}`) });
    VIEWS.filter(([, l]) => !t || l.toLowerCase().includes(t.toLowerCase())).forEach(([k, l, icon]) =>
      out.push({ icon, label: l, hint: "go to", run: () => go(k) }));
    return out;
  }, [q, pages, go, setAt]);

  const run = (i) => { const it = items[i]; if (it) { it.run(); onClose(); } };
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === "Enter") { e.preventDefault(); run(sel); }
    if (e.key === "Escape") onClose();
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="palette-bg" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="palette" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}>
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={key}
              placeholder="Search an article, ask a question, type a year, or jump to a page…" />
            <div className="pal-list">
              {items.map((it, i) => {
                const Icon = it.icon;
                return (
                  <div key={i} className={"pal-item" + (i === sel ? " sel" : "")} onMouseEnter={() => setSel(i)} onMouseDown={() => run(i)}>
                    <Icon size={16} /><span className="pal-label">{it.label}</span><span className="pal-hint">{it.hint}</span>
                    {i === sel && <CornerDownLeft size={14} className="pal-enter" />}
                  </div>
                );
              })}
            </div>
            <div className="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close · try “2008” or “Talvisota”</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
