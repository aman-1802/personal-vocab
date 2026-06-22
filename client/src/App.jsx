import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, Loader2, Check, AlertCircle, BarChart as BarIcon, Layers, BookOpen, Plus, ChevronLeft, Share2 } from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from "d3-force";

const CREAM = "#F5F0E4";
const INK = "#1A1A17";
const TINTS = ["#F2C94C", "#F39DB7", "#A9C7E8", "#C7D98C"];
const MIN_WORDS_FOR_WEB = 6;

function burstPath(points, outer, inner, cx, cy) {
  let d = "";
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    d += (i === 0 ? "M" : "L") + (cx + Math.cos(a) * r).toFixed(1) + "," + (cy + Math.sin(a) * r).toFixed(1);
  }
  return d + "Z";
}

function Seal({ size = 92, fill, children, rotate = 0, className = "" }) {
  const c = size / 2;
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size, transform: `rotate(${rotate}deg)` }}>
      <svg width={size} height={size} className="absolute inset-0"><path d={burstPath(12, c, c * 0.84, c, c)} fill={fill} strokeLinejoin="round" /></svg>
      <span className="relative font-semibold text-center px-1 leading-tight" style={{ transform: `rotate(${-rotate}deg)` }}>{children}</span>
    </div>
  );
}

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const INITIAL_RESULT = {
  word: "ephemeral",
  meaning: "Something that doesn't last long — here for a moment, then gone.",
  sentence: "The morning fog was ephemeral, burning off by nine.",
  synonyms: ["fleeting", "brief", "passing"],
  antonyms: ["lasting", "permanent"],
  savedAt: daysAgo(0),
};

function relative(dateStr) {
  const diff = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(dateStr).setHours(0, 0, 0, 0)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function nodeColor(id) {
  return TINTS[id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 4];
}

export default function VocabApp() {
  const [view, setView] = useState("search");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(INITIAL_RESULT);
  const [justSaved, setJustSaved] = useState(false);
  const [words, setWords] = useState([]);
  const [books, setBooks] = useState([]);
  const [stats, setStats] = useState(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [openBook, setOpenBook] = useState(null);
  const [newBook, setNewBook] = useState("");
  const [newNote, setNewNote] = useState("");

  const graphContainerRef = useRef(null);
  const graphInstanceRef = useRef(null);

  const loadWords = useCallback(async () => {
    try { const res = await fetch("/api/words"); if (res.ok) setWords(await res.json()); } catch (e) { console.error(e); }
  }, []);
  const loadBooks = useCallback(async () => {
    try { const res = await fetch("/api/books"); if (res.ok) setBooks(await res.json()); } catch (e) { console.error(e); }
  }, []);
  const loadStats = useCallback(async () => {
    try { const res = await fetch("/api/stats"); if (res.ok) setStats(await res.json()); } catch (e) { console.error(e); }
  }, []);
  const loadGraph = useCallback(async () => {
    try { const res = await fetch("/api/graph"); if (res.ok) setGraphData(await res.json()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadWords(); loadBooks(); loadStats(); loadGraph(); }, [loadWords, loadBooks, loadStats, loadGraph]);

  useEffect(() => {
    if (view === "web") loadGraph();
  }, [view, loadGraph]);

  // Pure canvas + d3-force graph — zero React/Preact bundled inside
  useEffect(() => {
    const container = graphContainerRef.current;
    if (view !== "web" || graphData.nodes.length < MIN_WORDS_FOR_WEB || !container) return;

    const w = container.offsetWidth;
    const h = container.offsetHeight;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.innerHTML = "";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    // Clone data so d3 can mutate freely
    const nodes = graphData.nodes.map((n) => ({ ...n }));
    const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const links = graphData.links.map((l) => ({
      source: nodeById[typeof l.source === "string" ? l.source : l.source.id] || l.source,
      target: nodeById[typeof l.target === "string" ? l.target : l.target.id] || l.target,
    }));

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CREAM;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(26,26,23,0.12)";
      ctx.lineWidth = 1.5;
      for (const l of links) {
        if (l.source?.x != null && l.target?.x != null) {
          ctx.beginPath();
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
          ctx.stroke();
        }
      }

      ctx.font = "600 10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const n of nodes) {
        if (n.x == null) continue;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 22, 0, 2 * Math.PI);
        ctx.fillStyle = nodeColor(n.id);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.fillText(n.id.length > 9 ? n.id.slice(0, 8) + "…" : n.id, n.x, n.y);
      }
    }

    const sim = forceSimulation(nodes)
      .force("link", forceLink(links).id((d) => d.id).distance(90))
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(w / 2, h / 2))
      .force("collide", forceCollide(28))
      .on("tick", draw);

    function onClick(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = nodes.find((n) => {
        const dx = (n.x ?? 0) - mx;
        const dy = (n.y ?? 0) - my;
        return Math.sqrt(dx * dx + dy * dy) < 22;
      });
      setSelectedNode((prev) => (prev?.id === hit?.id ? null : hit ?? null));
    }
    canvas.addEventListener("click", onClick);

    graphInstanceRef.current = sim;
    return () => {
      sim.stop();
      canvas.removeEventListener("click", onClick);
      graphInstanceRef.current = null;
      if (container) container.innerHTML = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, graphData.nodes.length]);

  // Re-run simulation when new words are added while on the Web tab
  useEffect(() => {
    if (graphInstanceRef.current && graphData.nodes.length >= MIN_WORDS_FOR_WEB) {
      graphInstanceRef.current.alpha(0.5).restart();
    }
  }, [graphData]);

  async function handleSearch(e) {
    e?.preventDefault();
    const word = query.trim();
    if (!word || loading) return;
    setError(null); setJustSaved(false); setLoading(true);
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word }) });
      if (!res.ok) throw new Error("lookup failed");
      const data = await res.json();
      setResult(data);
      if (data.isNew) { setJustSaved(true); loadWords(); loadStats(); loadGraph(); }
      setQuery("");
    } catch (e) { console.error(e); setError("Couldn't look that up. Try again?"); }
    setLoading(false);
  }

  async function addBook(e) {
    e?.preventDefault();
    const title = newBook.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/books", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      if (!res.ok) return;
      setNewBook(""); await loadBooks(); await loadStats();
    } catch (e) { console.error(e); }
  }

  async function addNote(book, e) {
    e?.preventDefault();
    const text = newNote.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/books/${book.id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) return;
      setNewNote(""); await loadBooks();
    } catch (e) { console.error(e); }
  }

  const last7 = stats?.last7Days || [];
  const screenBg = view === "stats" ? "#F3B8C8" : CREAM;
  const currentBook = books.find((b) => b.id === openBook);
  const wordsUntilWeb = Math.max(0, MIN_WORDS_FOR_WEB - graphData.nodes.length);

  return (
    <div
      className="h-[100dvh] w-full flex flex-col overflow-hidden transition-colors duration-500"
      style={{ background: screenBg, color: INK, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',Inter,sans-serif" }}
    >
      <style>{`
        @keyframes popIn{0%{opacity:0;transform:translateY(12px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes floatY{0%,100%{transform:translateY(0) rotate(var(--rot,0deg))}50%{transform:translateY(-7px) rotate(var(--rot,0deg))}}
        @keyframes checkPop{0%{transform:scale(0)}60%{transform:scale(1.25)}100%{transform:scale(1)}}
        .pop{animation:popIn .4s cubic-bezier(.2,.8,.2,1) both}
        .floaty{animation:floatY 6s ease-in-out infinite}
        .checkpop{animation:checkPop .4s cubic-bezier(.34,1.56,.64,1) both}
        @media (prefers-reduced-motion: reduce){.pop,.floaty,.checkpop{animation:none}}
      `}</style>

      {/* ===== SEARCH ===== */}
      {view === "search" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <svg className="absolute -top-6 -right-8 floaty" width="150" height="150" viewBox="0 0 100 100"><path d="M50 5 C70 8 95 20 92 45 C90 68 78 95 50 92 C25 90 6 75 8 50 C10 28 30 2 50 5Z" fill="#C7D98C" opacity="0.85" /></svg>
          <div className="px-6 pt-10 relative z-10">
            <h1 className="font-bold tracking-tight" style={{ fontSize: 40, lineHeight: 0.98, letterSpacing: "-0.03em" }}>What word<br />did you<br /><span className="italic" style={{ fontFamily: "Georgia,serif", fontWeight: 500 }}>meet today?</span></h1>
            <form onSubmit={handleSearch} className="relative mt-5">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a word from your book..." className={`w-full bg-white rounded-full pl-11 py-3.5 text-stone-900 placeholder-stone-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/15 transition-all ${query.trim() ? "pr-14" : "pr-4"}`} />
              {query.trim() && (
                <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[#F2C94C] rounded-full p-2.5 shadow-sm active:scale-90 transition-transform">
                  <Search size={16} strokeWidth={2.5} className="text-stone-900" />
                </button>
              )}
            </form>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2 relative z-10">
            {loading && <div className="flex flex-col items-center py-14 text-stone-400"><Loader2 size={26} className="animate-spin mb-2" /><span className="text-sm">Looking it up...</span></div>}
            {error && !loading && <div className="flex items-center gap-2 bg-white rounded-2xl px-4 py-3 text-rose-600 text-sm shadow-sm"><AlertCircle size={16} />{error}</div>}
            {result && !loading && (
              <div className="pop">
                <div className="flex items-end justify-between">
                  <h2 className="font-bold capitalize" style={{ fontSize: 38, lineHeight: 1, letterSpacing: "-0.02em" }}>{result.word}</h2>
                  {justSaved && <span className="flex items-center gap-1 text-xs font-bold bg-[#C7D98C] rounded-full px-2.5 py-1 checkpop"><Check size={13} strokeWidth={3} />Saved</span>}
                </div>
                <p className="mt-2.5 text-[15px] leading-relaxed text-stone-700">{result.meaning}</p>
                <div className="mt-4 bg-[#F2C94C] rounded-3xl p-4 shadow-sm" style={{ transform: "rotate(-2deg)" }}>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-900/70 mb-1">In a sentence</p>
                  <p className="text-stone-900 italic leading-snug">"{result.sentence}"</p>
                </div>
                {result.synonyms?.length > 0 && (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-5 mb-1">Means the same</p>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      {result.synonyms.slice(0, 3).map((s, i) => i === 0
                        ? <Seal key={s} size={86} fill="#F39DB7" rotate={-6} className="floaty text-stone-900 text-[13px]">{s}</Seal>
                        : i === 1
                        ? <div key={s} className="floaty rounded-full flex items-center justify-center text-stone-900 text-[13px] font-semibold shadow-sm" style={{ width: 80, height: 80, background: "#A9C7E8", "--rot": "4deg" }}>{s}</div>
                        : <div key={s} className="floaty flex items-center justify-center text-stone-900 text-[13px] font-semibold shadow-sm" style={{ width: 86, height: 76, background: "#C7D98C", borderRadius: "62% 38% 46% 54% / 58% 50% 50% 42%", "--rot": "-3deg" }}>{s}</div>
                      )}
                    </div>
                  </>
                )}
                {result.antonyms?.length > 0 && (
                  <div className="mt-5">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-1.5">Opposite</p>
                    <div className="flex flex-wrap gap-2">{result.antonyms.map((a) => <span key={a} className="px-3 py-1 rounded-full bg-white text-stone-600 text-sm font-medium shadow-sm">{a}</span>)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== LIBRARY ===== */}
      {view === "library" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <svg className="absolute top-24 -left-10 floaty" width="130" height="130" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#A9C7E8" opacity="0.55" /></svg>
          <div className="px-6 pt-10 relative z-10">
            <h1 className="font-bold tracking-tight" style={{ fontSize: 38, lineHeight: 1, letterSpacing: "-0.03em" }}>Words<br /><span className="italic" style={{ fontFamily: "Georgia,serif", fontWeight: 500 }}>just for you</span></h1>
            <p className="text-sm text-stone-500 mt-2">{words.length} collected</p>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2 relative z-10">
            {words.length === 0 ? (
              <p className="text-stone-400 text-sm text-center py-16 px-4">Look up a word in Discover<br />to start your collection.</p>
            ) : words.map((w, i) => (
              <div key={w.word + i} className="pop mb-3 rounded-3xl p-4 shadow-sm" style={{ background: TINTS[i % 4], transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`, animationDelay: `${Math.min(i * 50, 300)}ms` }}>
                <div className="flex items-center justify-between"><h3 className="font-bold text-stone-900 capitalize text-lg">{w.word}</h3><span className="text-xs font-medium text-stone-700/70">{relative(w.savedAt)}</span></div>
                <p className="text-sm text-stone-800/80 mt-0.5 line-clamp-2">{w.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== BOOKS ===== */}
      {view === "books" && !currentBook && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <svg className="absolute -top-4 -right-6 floaty" width="120" height="120" viewBox="0 0 100 100"><path d="M50 6 C68 6 92 22 90 48 C88 70 74 94 50 92 C28 90 8 74 10 48 C12 26 32 6 50 6Z" fill="#F39DB7" opacity="0.7" /></svg>
          <div className="px-6 pt-10 relative z-10">
            <h1 className="font-bold tracking-tight" style={{ fontSize: 38, lineHeight: 1, letterSpacing: "-0.03em" }}>Books<br /><span className="italic" style={{ fontFamily: "Georgia,serif", fontWeight: 500 }}>you've read</span></h1>
            <form onSubmit={addBook} className="relative mt-4">
              <input value={newBook} onChange={(e) => setNewBook(e.target.value)} placeholder="Add a book title..." className="w-full bg-white rounded-full pl-5 pr-12 py-3 text-stone-900 placeholder-stone-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/15" />
              <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[#F2C94C] rounded-full p-2 shadow-sm active:scale-90 transition-transform"><Plus size={18} strokeWidth={2.5} className="text-stone-900" /></button>
            </form>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2 relative z-10">
            {books.length === 0 ? (
              <p className="text-stone-400 text-sm text-center py-16 px-4">Add your first book above.</p>
            ) : books.map((b, i) => (
              <button key={b.id} onClick={() => setOpenBook(b.id)} className="pop w-full text-left mb-3 rounded-3xl p-4 shadow-sm active:scale-[0.98] transition-transform" style={{ background: TINTS[i % 4], transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`, animationDelay: `${Math.min(i * 60, 300)}ms` }}>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-stone-900 text-lg leading-tight pr-2">{b.title}</h3>
                  <span className="text-xs font-medium text-stone-700/70 whitespace-nowrap">{relative(b.addedAt)}</span>
                </div>
                <p className="text-sm text-stone-800/70 mt-1">{(b.notes?.length || 0)} note{(b.notes?.length || 0) === 1 ? "" : "s"}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ===== BOOK DETAIL ===== */}
      {view === "books" && currentBook && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 pt-10 relative z-10">
            <button onClick={() => { setOpenBook(null); setNewNote(""); }} className="flex items-center gap-1 text-sm font-semibold text-stone-500 mb-2 active:opacity-60"><ChevronLeft size={18} />Books</button>
            <h1 className="font-bold tracking-tight px-1" style={{ fontSize: 30, lineHeight: 1.02, letterSpacing: "-0.02em" }}>{currentBook.title}</h1>
            <p className="text-sm text-stone-500 mt-1.5 px-1">Added {new Date(currentBook.addedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2 relative z-10">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 px-1">Notes</p>
            {(currentBook.notes?.length || 0) === 0 && <p className="text-sm text-stone-400 px-1 py-6">No notes yet. Jot something below.</p>}
            {(currentBook.notes || []).slice().reverse().map((n, i) => (
              <div key={i} className="pop bg-white rounded-2xl p-3.5 mb-2.5 shadow-sm">
                <p className="text-stone-800 text-[15px] leading-relaxed">{n.text}</p>
                <p className="text-xs text-stone-400 mt-1.5">{relative(n.at)}</p>
              </div>
            ))}
          </div>
          <div className="px-5 pb-3 pt-1 relative z-10">
            <form onSubmit={(e) => addNote(currentBook, e)} className="relative">
              <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note..." className="w-full bg-white rounded-full pl-5 pr-12 py-3 text-stone-900 placeholder-stone-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/15" />
              <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[#C7D98C] rounded-full p-2 shadow-sm active:scale-90 transition-transform"><Plus size={18} strokeWidth={2.5} className="text-stone-900" /></button>
            </form>
          </div>
        </div>
      )}

      {/* ===== STATS ===== */}
      {view === "stats" && (
        <div className="flex-1 flex flex-col overflow-hidden text-stone-900">
          <div className="px-6 pt-10 relative z-10">
            <p className="text-sm font-semibold text-rose-900/60">Reading flow</p>
            <h1 className="font-bold tracking-tight" style={{ fontSize: 36, lineHeight: 1, letterSpacing: "-0.03em" }}>Your reading week</h1>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2 relative z-10">
            <div className="flex justify-between mb-4">{last7.map((d, i) => <div key={i} className="flex items-center justify-center rounded-full text-[11px] font-bold" style={{ width: 32, height: 32, background: d.isToday ? "#9D174D" : "rgba(255,255,255,0.7)", color: d.isToday ? "#fff" : "#57534e" }}>{d.label}</div>)}</div>
            <div className="bg-white/70 rounded-3xl p-4 shadow-sm mb-4">
              <div className="flex items-baseline justify-between mb-1"><span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">New words</span><span className="text-2xl font-bold">{stats?.wordsLast7 ?? 0}<span className="text-sm font-medium text-stone-400"> this week</span></span></div>
              <ResponsiveContainer width="100%" height={120}><BarChart data={last7} barCategoryGap="32%"><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9a8a8e" }} /><Bar dataKey="count" radius={[8, 8, 8, 8]}>{last7.map((d, i) => <Cell key={i} fill={d.isToday ? "#9D174D" : "#F39DB7"} />)}</Bar></BarChart></ResponsiveContainer>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 bg-white/70 rounded-3xl p-4 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">Words / month</p><p className="text-3xl font-bold mt-1">{stats?.wordsLast30 ?? 0}</p></div>
              <div className="flex-1 bg-rose-900 text-white rounded-3xl p-4 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-widest text-white/60">Books</p><p className="text-3xl font-bold mt-1">{stats?.totalBooks ?? 0}</p></div>
            </div>
          </div>
        </div>
      )}

      {/* ===== WEB ===== */}
      {view === "web" && (
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div className="px-6 pt-10 pb-2 relative z-10 shrink-0">
            <h1 className="font-bold tracking-tight" style={{ fontSize: 38, lineHeight: 1, letterSpacing: "-0.03em" }}>Word<br /><span className="italic" style={{ fontFamily: "Georgia,serif", fontWeight: 500 }}>web</span></h1>
            <p className="text-sm text-stone-500 mt-1">{graphData.nodes.length} word{graphData.nodes.length !== 1 ? "s" : ""} · {graphData.links.length} connection{graphData.links.length !== 1 ? "s" : ""}</p>
          </div>

          {wordsUntilWeb > 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
              <div className="flex items-center justify-center gap-3 mb-8">
                {TINTS.map((t, i) => (
                  <div key={i} className="floaty rounded-full shadow-md flex items-center justify-center text-[11px] font-bold text-stone-700" style={{ width: 52 + i * 8, height: 52 + i * 8, background: t, "--rot": `${(i - 1.5) * 5}deg`, animationDelay: `${i * 0.4}s` }}>
                    {["word", "link", "idea", "web"][i]}
                  </div>
                ))}
              </div>
              <p className="font-bold text-xl text-stone-800 mb-2">Your web is forming</p>
              <p className="text-stone-500 text-[15px] leading-relaxed">
                Look up <span className="font-bold text-stone-800">{wordsUntilWeb}</span> more word{wordsUntilWeb !== 1 ? "s" : ""} and watch your first connections appear.
              </p>
              <div className="mt-6 bg-white/70 rounded-2xl px-6 py-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-1">Words so far</p>
                <p className="text-3xl font-bold text-stone-800">{graphData.nodes.length} <span className="text-base font-normal text-stone-400">/ {MIN_WORDS_FOR_WEB}</span></p>
              </div>
            </div>
          ) : (
            <div ref={graphContainerRef} className="flex-1 relative" />
          )}

          {/* Tapped node card */}
          {selectedNode && (
            <div className="absolute bottom-4 left-4 right-4 pop z-30">
              <div className="rounded-3xl p-4 shadow-xl border border-white/40" style={{ background: nodeColor(selectedNode.id) }}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-lg capitalize text-stone-900">{selectedNode.id}</h3>
                  <button onClick={() => setSelectedNode(null)} className="text-stone-500 text-xl leading-none mt-0.5 shrink-0">×</button>
                </div>
                <p className="text-sm text-stone-800/80 mt-1 leading-relaxed">{selectedNode.meaning}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== bottom nav ===== */}
      <div className="relative z-20 px-4 pb-6 pt-1">
        <div className="bg-white/50 backdrop-blur-2xl rounded-full shadow-lg border border-white/60 flex items-center justify-around py-2.5 px-1">
          {[
            { key: "search", label: "Discover", icon: Search },
            { key: "library", label: "Words", icon: Layers },
            { key: "books", label: "Books", icon: BookOpen },
            { key: "stats", label: "Flow", icon: BarIcon },
            { key: "web", label: "Web", icon: Share2 },
          ].map(({ key, label, icon: Icon }) => {
            const active = view === key;
            return (
              <button key={key} onClick={() => { setView(key); if (key === "books") setOpenBook(null); if (key !== "web") setSelectedNode(null); }} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-full transition-all duration-300 ${active ? "bg-[#F2C94C]" : ""}`}>
                <Icon size={17} strokeWidth={2.2} className={active ? "text-stone-900" : "text-stone-400"} />
                <span className={`text-[9px] font-semibold ${active ? "text-stone-900" : "text-stone-400"}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
