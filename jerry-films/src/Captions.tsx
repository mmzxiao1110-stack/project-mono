import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type Scene = { text: string; start: number; voiceDur: number };

// Word timings are estimated from character counts across each spoken line,
// then shown in chunks of up to 3 words with the active word highlighted.
const chunk = (scene: Scene) => {
  const words = scene.text.split(/\s+/);
  const weights = words.map((w) => w.replace(/[^a-z0-9]/gi, "").length + 2 + (/[.,?!…]$/.test(w) ? 4 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const timed = words.map((w, i) => {
    const s = scene.start + (acc / total) * scene.voiceDur;
    acc += weights[i];
    return { w, s, e: scene.start + (acc / total) * scene.voiceDur };
  });
  const groups: (typeof timed)[] = [];
  let cur: typeof timed = [];
  for (const x of timed) {
    cur.push(x);
    if (cur.length === 3 || /[.,?!]$/.test(x.w)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
};

export const Captions: React.FC<{ scenes: Scene[] }> = ({ scenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = frame / fps;
  const groups = scenes.flatMap(chunk);
  const g = groups.find((gr, i) => now >= gr[0].s && now < (groups[i + 1]?.[0].s ?? gr[gr.length - 1].e + 0.6));
  if (!g) return null;
  const pop = spring({ frame: frame - Math.round(g[0].s * fps), fps, config: { damping: 12, stiffness: 220 } });
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: 1430,
        textAlign: "center",
        fontFamily: "JerryCaption, Inter, sans-serif",
        fontSize: 92,
        lineHeight: 1.1,
        color: "white",
        WebkitTextStroke: "14px black",
        paintOrder: "stroke fill",
        textShadow: "0 8px 0 rgba(0,0,0,0.35)",
        transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`,
      }}
    >
      {g.map((x) => (
        <span key={x.s} style={{ color: now >= x.s ? (/squeak|duck/i.test(x.w) ? "#ffd31f" : "white") : "rgba(255,255,255,0.55)" }}>
          {x.w}{" "}
        </span>
      ))}
    </div>
  );
};
