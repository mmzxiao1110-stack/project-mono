/* eslint-disable react-refresh/only-export-components -- a shared kit: components plus the helpers that go with them */
/**
 * The site around the game: T-Terminal and the About / News / Download / Help
 * pages. Same look as the game: the pixel sky, glass panes with stepped
 * corners, Silkscreen at one pixel size. Each page has its own colour.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../fonts.css";
import "../index.css";
import { SkyCanvas } from "../sky.jsx";
import { themeVars } from "../theme.js";
import { VERSION_LABEL } from "../version.js";
import { ACCENTS } from "./colors.js";

/* ------------------------------------------------------------------
   Colours: one palette per page, all built like the game's aquarium.
   ------------------------------------------------------------------ */
const base = { stroke: "pixel", gap: 1, colorblind: false, motion: true };
export const PAGES = {
  game: { href: "/", label: "PLAY", accent: ACCENTS.game,
    pal: { ground: "#1B1A21", panel: "#2B2932", line: "#4A4656", cell: "#232129", text: "#F2E8D2", dim: "#ABA1CF", you: "#7CC7BF", rival: "#EAD6A4", special: "#B4A3EE" } },
  terminal: { href: "/terminal", label: "T-TERMINAL", accent: ACCENTS.terminal,
    pal: { ground: "#0C1330", panel: "#1B2A55", line: "#33498A", cell: "#14204A", text: "#EAF2FF", dim: "#93A9DC", you: "#6FA8FF", rival: "#A8CBFF", special: "#6FE3EC" } },
  about: { href: "/about", label: "ABOUT", accent: ACCENTS.about,
    pal: { ground: "#1D1913", panel: "#3A3226", line: "#5E503A", cell: "#2A241B", text: "#F8EFDD", dim: "#CDBB94", you: "#EAD6A4", rival: "#F2B880", special: "#F5E3A8" } },
  news: { href: "/news", label: "NEWS", accent: ACCENTS.news,
    pal: { ground: "#0D1B1B", panel: "#1E3A38", line: "#33605C", cell: "#142928", text: "#E9FBF7", dim: "#93C9C1", you: "#7CC7BF", rival: "#B4EADF", special: "#A6E3B8" } },
  download: { href: "/download", label: "DOWNLOAD", accent: ACCENTS.download,
    pal: { ground: "#1E1118", panel: "#3D2233", line: "#66395A", cell: "#2B1824", text: "#FDEBF3", dim: "#D69CB8", you: "#EC93B8", rival: "#F6BBD2", special: "#F2C2A0" } },
  help: { href: "/help", label: "HELP", accent: ACCENTS.help,
    pal: { ground: "#111B11", panel: "#253A25", line: "#3E613E", cell: "#182818", text: "#EEFBEA", dim: "#A3CC9A", you: "#A3D98C", rival: "#D4EEA6", special: "#E6E39A" } },
};

/* ------------------------------------------------------------------
   Pixels
   ------------------------------------------------------------------ */
/** The pixel size for the page: 2 on phones, 3 on most screens, 4 on very big ones. */
function usePixel() {
  const pick = () => (window.innerWidth >= 1700 && window.innerHeight >= 1000 ? 4 : window.innerWidth >= 720 ? 3 : 2);
  const [p, setP] = useState(pick);
  useEffect(() => { const on = () => setP(pick()); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  return p;
}

const PX = "var(--p)";
const px = (n) => `calc(var(--p) * ${n})`;
/** Stepped corners, as on every pane in the game. */
export const CLIP = `polygon(0 ${px(2)}, ${PX} ${px(2)}, ${PX} ${PX}, ${px(2)} ${PX}, ${px(2)} 0, calc(100% - ${px(2)}) 0, calc(100% - ${px(2)}) ${PX}, calc(100% - ${PX}) ${PX}, calc(100% - ${PX}) ${px(2)}, 100% ${px(2)}, 100% calc(100% - ${px(2)}), calc(100% - ${PX}) calc(100% - ${px(2)}), calc(100% - ${PX}) calc(100% - ${PX}), calc(100% - ${px(2)}) calc(100% - ${PX}), calc(100% - ${px(2)}) 100%, ${px(2)} 100%, ${px(2)} calc(100% - ${PX}), ${PX} calc(100% - ${PX}), ${PX} calc(100% - ${px(2)}), 0 calc(100% - ${px(2)}))`;
const BEVEL = `inset ${PX} ${PX} 0 var(--tb-edge), inset calc(var(--p) * -1) calc(var(--p) * -1) 0 var(--tb-shade)`;
/** A pane of glass with a pixel frame in `color`. */
export const glass = (color = "var(--tb-line)") => ({
  borderWidth: PX, borderStyle: "solid", borderColor: color, clipPath: CLIP, boxShadow: BEVEL,
  background: "color-mix(in srgb, var(--tb-text) 7%, transparent)",
});
/** The same, tinted and lit: a primary button or a selected tab. */
export const glassFill = (color = "var(--tb-you)") => ({
  borderWidth: PX, borderStyle: "solid", borderColor: color, clipPath: CLIP,
  background: `color-mix(in srgb, ${color} 30%, transparent)`,
  boxShadow: `inset 0 ${PX} 0 color-mix(in srgb, ${color} 60%, white), inset 0 calc(var(--p) * -1) 0 color-mix(in srgb, ${color} 55%, black)`,
});

/** A word in big pixel letters: every font pixel is a 2×2 block, shaded from `from` to `to`. */
export function PixelWord({ text, from = "var(--tb-you)", to = "var(--tb-rival)", scale = 2, className = "" }) {
  // Titles are the game's own font, bold capitals, shaded top to bottom from
  // one colour to the other. Silkscreen's capitals are 5 of its 8 em-pixels
  // tall, so this is as tall as the old 7-row pixel letters at this scale.
  const size = (7 * scale * 8) / 5;
  return (
    <span role="img" aria-label={String(text)} className={`tb-title ${className}`}
      style={{
        fontFamily: '"Silkscreen", ui-monospace, monospace', fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap",
        fontSize: `calc(var(--p) * ${size})`, lineHeight: 1, letterSpacing: `calc(var(--p) * ${Math.max(1, scale / 2)})`,
        display: "inline-block", paddingRight: "calc(var(--p) * 1)",
        background: `linear-gradient(180deg, color-mix(in srgb, white 35%, ${from}) 0%, ${from} 30%, ${to} 100%)`,
        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
        filter: `drop-shadow(var(--p) var(--p) 0 rgba(0,0,0,.5))`,
      }}>{text}</span>
  );
}

/** A page title with the version beside it. */
export function Title({ text, sub }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ gap: px(3), marginBottom: px(8) }}>
      <div className="flex items-end" style={{ gap: px(3) }}>
        <PixelWord text={text} />
        <span className="tb-t" style={{ color: "var(--tb-dim)", opacity: 0.6 }}>{VERSION_LABEL}</span>
      </div>
      {sub && <div className="tb-t" style={{ color: "var(--tb-dim)" }}>{sub}</div>}
    </div>
  );
}

/** A framed glass pane. */
export function Panel({ children, color, style, className = "" }) {
  return <div className={className} style={{ ...glass(color), padding: px(6), ...style }}>{children}</div>;
}

/** The bar across the top: home, then every page, each in its own colour. */
function Nav({ current }) {
  return (
    <nav className="w-full flex flex-wrap items-center justify-center" style={{ gap: px(2), padding: `${px(4)} ${px(3)}` }}>
      {Object.entries(PAGES).map(([key, pg]) => (
        <a key={key} href={pg.href} className="tb-t no-underline flex items-center"
          aria-current={key === current ? "page" : undefined}
          style={{
            height: px(14), padding: `0 ${px(4)}`, color: key === current ? "var(--tb-text)" : pg.accent,
            ...(key === current ? glassFill(pg.accent) : glass(`color-mix(in srgb, ${pg.accent} 45%, transparent)`)),
          }}>
          {pg.label}
        </a>
      ))}
    </nav>
  );
}

/** Everything a site page needs: colours, the sky, nav, footer. */
export function SiteShell({ page, children, maxWidth = 760 }) {
  const P = usePixel();
  const { pal } = PAGES[page];
  const theme = { ...base, ...pal };
  useEffect(() => { document.documentElement.style.background = pal.ground; }, [pal.ground]);
  return (
    <>
      <style>{`
        :root { ${themeVars(theme)} --p: ${P}px; }
        html, body, #root { background: var(--tb-ground); min-height: 100%; }
        body { margin: 0; color: var(--tb-text); }
        .font-mono { font-family: "Silkscreen", ui-monospace, monospace; font-weight: 400; font-synthesis: none; -webkit-font-smoothing: none; }
        .tb-t { font-size: calc(var(--p) * 8); line-height: calc(var(--p) * 11); }
        .tb-b { font-weight: 700; }
        .tb-prose p { margin: 0 0 calc(var(--p) * 6); }
        .tb-prose a, a.tb-link { color: var(--tb-you); }
        canvas, svg { image-rendering: pixelated; }
        a, button { cursor: pointer; -webkit-tap-highlight-color: transparent; }
        a:hover, button:not(:disabled):hover { filter: brightness(1.2); }
        button:not(:disabled):active, a:active { transform: translateY(var(--p)); }
        a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--tb-text); outline-offset: 2px; }
        input::placeholder { color: var(--tb-dim); }
        @keyframes tbPulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
        .tb-pulse { animation: tbPulse 1.2s steps(4) infinite; }
      `}</style>
      <SkyCanvas theme={theme} px={P} />
      <div className="relative font-mono min-h-screen flex flex-col items-center" style={{ zIndex: 1, color: "var(--tb-text)" }}>
        <Nav current={page} />
        <main className="w-full flex-1" style={{ maxWidth, padding: `${px(6)} ${px(4)} ${px(10)}` }}>{children}</main>
        <footer className="tb-t flex flex-wrap justify-center" style={{ gap: px(6), padding: px(6), color: "var(--tb-dim)" }}>
          <a href="/privacy" className="tb-link" style={{ color: "var(--tb-dim)" }}>PRIVACY</a>
          <a href="/terms" className="tb-link" style={{ color: "var(--tb-dim)" }}>TERMS</a>
          <span>TESELLA {VERSION_LABEL}</span>
        </footer>
      </div>
    </>
  );
}

/** Mounts a page component into #root. */
export function mount(node) {
  createRoot(document.getElementById("root")).render(node);
}
