import { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import { CatmullRomCurve3, DoubleSide, Vector3 } from "three";
import { CameraRig } from "../lib/CameraRig";
import { Duck } from "../lib/Duck";
import { StudioLights } from "../lib/Lights";
import { C, FPS, pulse, smooth } from "../lib/style";

const SQUEAKS = [0.8, 1.6, 2.4];

// Cut-away of the oesophagus: the duck squeezes down, squeaking.
export const Throat: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useCurrentFrame() / FPS;
  const curve = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(0, 9, 0),
        new Vector3(0.6, 4, 0),
        new Vector3(-0.5, -1, 0),
        new Vector3(0.4, -6, 0),
        new Vector3(0, -12, 0),
      ]),
    []
  );
  const u = 0.08 + 0.84 * smooth(t / (dur - 0.3));
  const p = curve.getPointAt(u);
  const tan = curve.getTangentAt(u);
  const squash = Math.max(...SQUEAKS.map((s) => pulse(t, s, 0.14)));
  const rings = Array.from({ length: 16 }, (_, i) => i / 15);
  return (
    <>
      <CameraRig t={t} pos={[p.x + 6.5, p.y + 1.5, p.z + 9]} look={[p.x, p.y - 0.4, p.z]} fov={36} />
      <StudioLights />
      {/* tube wall, cut-away look */}
      <mesh>
        <tubeGeometry args={[curve, 200, 1.55, 48, false]} />
        <meshStandardMaterial color={C.flesh} roughness={0.55} side={DoubleSide} transparent opacity={0.6} depthWrite={false} />
      </mesh>
      {/* muscle rings – peristaltic wave follows just behind the duck */}
      {rings.map((r) => {
        const rp = curve.getPointAt(r);
        const rt = curve.getTangentAt(r);
        const squeeze = pulse(r, u - 0.06, 0.07);
        const s = 1 - 0.35 * squeeze;
        return (
          <mesh key={r} position={rp} quaternion={quatFromUp(rt)} scale={[s, s, 1]}>
            <torusGeometry args={[1.58, 0.08, 12, 48]} />
            <meshStandardMaterial color={C.fleshDeep} roughness={0.5} />
          </mesh>
        );
      })}
      <Duck
        position={[p.x, p.y, p.z]}
        rotation={[0, -0.5, -Math.PI / 2 + 0.3 * Math.atan2(tan.x, -tan.y) + 0.12 * Math.sin(t * 5)]}
        scale={0.55}
        squash={squash * 0.6}
      />
      {/* squeak rings */}
      {SQUEAKS.map((s) => {
        const k = t - s;
        if (k < 0 || k > 0.5) return null;
        return (
          <mesh key={s} position={[p.x + 0.2, p.y, p.z + 0.2]} scale={1 + k * 6}>
            <torusGeometry args={[0.6, 0.04, 8, 48]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={1 - k * 2} />
          </mesh>
        );
      })}
    </>
  );
};

import { Quaternion } from "three";
const Z = new Vector3(0, 0, 1);
const quatFromUp = (dir: Vector3) => new Quaternion().setFromUnitVectors(Z, dir.clone().normalize());
