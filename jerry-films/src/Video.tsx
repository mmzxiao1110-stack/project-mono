import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import timeline from "../public/timeline.json";
import { Captions } from "./Captions";
import { C, FPS, H, W } from "./lib/style";
import { Hiccup } from "./scenes/Hiccup";
import { Stomach } from "./scenes/Stomach";
import { Swallow } from "./scenes/Swallow";
import { Throat } from "./scenes/Throat";

const sc = Object.fromEntries(timeline.scenes.map((s) => [s.id, s]));
const f = (sec: number) => Math.round(sec * FPS);

const Backdrop: React.FC<{ inside?: boolean }> = ({ inside }) => (
  <AbsoluteFill
    style={{
      background: inside
        ? "radial-gradient(circle at 50% 40%, #7a2a38 0%, #2a0a10 80%)"
        : `radial-gradient(circle at 50% 35%, ${C.bgTop} 0%, ${C.bgBottom} 85%)`,
    }}
  />
);

const Shot: React.FC<{ children: React.ReactNode; inside?: boolean }> = ({ children, inside }) => (
  <AbsoluteFill>
    <Backdrop inside={inside} />
    <ThreeCanvas width={W} height={H} shadows gl={{ antialias: true, alpha: true }}>
      {children}
    </ThreeCanvas>
  </AbsoluteFill>
);

const DayBadge: React.FC = () => {
  const frame = useCurrentFrame();
  const day = 1 + Math.min(2, Math.floor(frame / f(0.75)));
  const o = interpolate(frame, [0, 6, f(2.4), f(2.6)], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 300, width: "100%", textAlign: "center", opacity: o }}>
      <span style={{ fontFamily: "JerryCaption", fontSize: 70, color: "#1d2a36", background: "#ffd31f", padding: "14px 44px", borderRadius: 60 }}>
        DAY {day}
      </span>
    </div>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `rgba(20,30,40,${0.75 * o})`, justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ fontFamily: "JerryCaption", fontSize: 130, color: "white", WebkitTextStroke: "12px black", paintOrder: "stroke fill" }}>
        JERRY <span style={{ color: "#ffd31f" }}>FILMS</span>
      </div>
    </AbsoluteFill>
  );
};

export const JerryVideo: React.FC = () => {
  const acidStart = sc.acid.start;
  const hic = sc.hiccup;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <style>{`@font-face { font-family: JerryCaption; src: url(${staticFile("Inter-ExtraBold.otf")}); }`}</style>
      <Sequence durationInFrames={f(sc.throat.start)}>
        <Shot><Swallow /></Shot>
      </Sequence>
      <Sequence from={f(sc.throat.start)} durationInFrames={f(sc.throat.dur)}>
        <Shot inside><Throat dur={sc.throat.dur} /></Shot>
      </Sequence>
      <Sequence from={f(acidStart)} durationInFrames={f(hic.start - acidStart)}>
        <Shot inside>
          <Stomach
            cues={{
              float: sc.float.start - acidStart,
              squeeze1: sc.squeeze1.start - acidStart,
              squeeze2: sc.squeeze2.start - acidStart,
              end: hic.start - acidStart,
            }}
          />
        </Shot>
      </Sequence>
      <Sequence from={f(hic.start)}>
        <Shot><Hiccup /></Shot>
      </Sequence>
      <Sequence from={f(hic.start)} durationInFrames={f(2.6)}>
        <DayBadge />
      </Sequence>
      <Captions scenes={timeline.scenes} />
      <Sequence from={f(timeline.total - 1.1)}>
        <EndCard />
      </Sequence>
      <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", fontFamily: "JerryCaption", fontSize: 38, letterSpacing: 6, color: "rgba(255,255,255,0.7)" }}>
        JERRY FILMS
      </div>
      <Audio src={staticFile("audio.wav")} />
    </AbsoluteFill>
  );
};
