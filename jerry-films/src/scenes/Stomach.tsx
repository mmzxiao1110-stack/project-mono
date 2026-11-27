import { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import { BackSide, CircleGeometry, SphereGeometry } from "three";
import { CameraRig } from "../lib/CameraRig";
import { Duck } from "../lib/Duck";
import { C, FPS, pulse, rand, smooth } from "../lib/style";

export type StomachCues = {
  float: number;    // seconds from scene start
  squeeze1: number;
  squeeze2: number;
  end: number;
};

const ACID_Y = -1.7;

// Inside the stomach: splash, a razor blade dissolving, bobbing, two squeezes.
export const Stomach: React.FC<{ cues: StomachCues }> = ({ cues }) => {
  const t = useCurrentFrame() / FPS;

  // wall squeeze amount over time
  const sq1 = smooth((t - cues.squeeze1 - 0.6) / 0.5) * (1 - smooth((t - cues.squeeze1 - 1.5) / 0.5));
  const sq2 = smooth((t - cues.squeeze2 - 0.4) / 0.45) * (1 - smooth((t - cues.squeeze2 - 1.3) / 0.4));
  const squeeze = 0.22 * sq1 + 0.42 * sq2;

  const wall = useMemo(() => {
    const g = new SphereGeometry(9, 160, 120);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // rugae: wavy folds running along the long axis
      const fold = 0.35 * Math.sin(y * 2.2 + Math.sin(x * 0.7) * 1.5) + 0.15 * Math.sin(z * 3.1 + x);
      const k = 1 + fold / 9;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const acid = useMemo(() => new CircleGeometry(14, 160), []);
  {
    const p = acid.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const r = Math.hypot(x, y);
      const splash = t < 1.6 ? 0.35 * Math.sin(r * 3 - t * 9) * Math.exp(-r * 0.4) * (1 - t / 1.6) : 0;
      p.setZ(i, 0.08 * Math.sin(x * 1.3 + t * 2.1) + 0.06 * Math.cos(y * 1.7 - t * 1.6) + splash);
    }
    p.needsUpdate = true;
    acid.computeVertexNormals();
  }

  // duck: drops in, then bobs
  const drop = smooth(t / 0.45);
  const bob = 0.12 * Math.sin(t * 2.6) + 0.05 * Math.sin(t * 4.1);
  const duckY = t < 0.45 ? 7 - (7 - ACID_Y - 0.35) * drop * drop : ACID_Y + 0.35 + bob - 0.25 * pulse(t, 0.55, 0.2);
  const duckSquash = 0.45 * pulse(t, cues.squeeze1 + 1.25, 0.18) + 0.85 * pulse(t, cues.squeeze2 + 0.95, 0.25);

  // razor blade: falls at ~3.1s, dissolves by ~5.2s
  const bladeIn = smooth((t - 3.0) / 0.5);
  const bladeGone = smooth((t - 3.7) / 1.5);

  // camera shots
  let pos: [number, number, number];
  let look: [number, number, number] = [0, ACID_Y + 0.4, 0];
  let fov = 40;
  if (t < cues.float) {
    const k = smooth(t / cues.float);
    pos = [3.5 - 1.5 * k, 2.5 - 0.8 * k, 7.5 - 0.5 * k];
    look = [-0.6 * smooth((t - 3) / 1), ACID_Y + 0.3, 0];
  } else if (t < cues.squeeze1) {
    const a = (t - cues.float) * 0.35 + 0.4;
    pos = [Math.sin(a) * 5.4, ACID_Y + 1.8, Math.cos(a) * 5.4];
    look = [0, ACID_Y + 0.6, 0];
    fov = 34;
  } else {
    const k = smooth((t - cues.squeeze1) / (cues.end - cues.squeeze1));
    pos = [2.6 - 0.5 * k, ACID_Y + 1.5 - 0.2 * k, 4.6 - 0.5 * k];
    look = [0, ACID_Y + 0.6, 0];
    fov = 38;
  }
  const shake = pulse(t, cues.squeeze2 + 1.0, 0.35);

  const bubbles = Array.from({ length: 40 }, (_, i) => i);

  return (
    <>
      <CameraRig t={t} pos={pos} look={look} fov={fov} shake={shake} />
      <ambientLight intensity={0.35} color="#ffb3b3" />
      <pointLight position={[0, 4, 3]} intensity={60} distance={30} color="#ffe2d4" castShadow />
      <pointLight position={[3.5, ACID_Y + 0.8, 3.5]} intensity={12} distance={12} color="#c8ff6a" />
      <directionalLight position={[2, 6, 5]} intensity={1.1} color="#fff1e0" />
      <mesh geometry={wall} scale={[1.35 * (1 - squeeze), 0.8 * (1 - squeeze * 0.5), 1 - squeeze]} position={[0, 1, 0]}>
        <meshStandardMaterial color={C.flesh} roughness={0.42} metalness={0.05} side={BackSide} />
      </mesh>
      <mesh geometry={acid} rotation={[-Math.PI / 2, 0, 0]} position={[0, ACID_Y, 0]}>
        <meshStandardMaterial color={C.acid} emissive="#5f9a10" emissiveIntensity={0.55} roughness={0.15} transparent opacity={0.9} />
      </mesh>
      {bubbles.map((i) => {
        const period = 1.4 + rand(i) * 1.6;
        const ph = ((t + rand(i + 50) * period) % period) / period;
        const near = i < 12 && t > 3.6 && t < 5.4; // sizzle around the blade
        const bx = near ? -2.2 + (rand(i + 9) - 0.5) * 1.4 : (rand(i + 3) - 0.5) * 12;
        const bz = near ? 0.4 + (rand(i + 7) - 0.5) * 1.0 : (rand(i + 5) - 0.5) * 8;
        const s = (0.06 + rand(i + 11) * 0.1) * (1 - ph * 0.5);
        return (
          <mesh key={i} position={[bx, ACID_Y + ph * (near ? 0.9 : 0.35), bz]} scale={s}>
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color="#e6ffb0" roughness={0.1} transparent opacity={0.85 * (1 - ph)} />
          </mesh>
        );
      })}
      {bladeIn > 0 && bladeGone < 1 && (
        <group
          position={[-2.2, 2.5 - (2.5 - ACID_Y - 0.05) * bladeIn - 0.25 * bladeGone, 0.4]}
          rotation={[0.25, 0.4, 0.1]}
          scale={[1 - 0.8 * bladeGone, 1, 1 - 0.8 * bladeGone]}
        >
          <mesh>
            <boxGeometry args={[1.8, 0.03, 0.8]} />
            <meshStandardMaterial color="#d9dee5" metalness={1} roughness={0.25 + bladeGone * 0.6} transparent opacity={1 - bladeGone * 0.7} />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[1.0, 0.035, 0.16]} />
            <meshStandardMaterial color="#59606a" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      )}
      <Duck
        position={[0, duckY, 0]}
        rotation={[0.08 * Math.sin(t * 2), -0.75 + 0.25 * Math.sin(t * 0.7), 0.06 * Math.sin(t * 2.6)]}
        scale={0.62}
        squash={duckSquash}
      />
      {[cues.squeeze1 + 1.25, cues.squeeze2 + 0.95].map((s, j) => {
        const k = t - s;
        if (k < 0 || k > 0.6) return null;
        return (
          <mesh key={s} position={[0, duckY + 0.6, 0]} rotation={[0, Math.PI / 4, 0]} scale={(1 + k * (j ? 9 : 5))}>
            <torusGeometry args={[0.5, 0.035, 8, 48]} />
            <meshBasicMaterial color="#fffbe0" transparent opacity={1 - k / 0.6} />
          </mesh>
        );
      })}
    </>
  );
};
