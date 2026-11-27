import { useCurrentFrame } from "remotion";
import { CameraRig } from "../lib/CameraRig";
import { Head } from "../lib/Head";
import { StudioLights } from "../lib/Lights";
import { FPS, pulse, smooth } from "../lib/style";

export const HICCUP_AT = 2.6;

// Outro: three days later, every hiccup squeaks.
export const Hiccup: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const jolt = pulse(t, HICCUP_AT + 0.08, 0.14);
  const push = smooth(t / 4.5);
  return (
    <>
      <CameraRig t={t} pos={[-2.6 + 1.4 * push, 0.3, 24 - 5 * push]} look={[0, -0.4, 0]} fov={34} shake={jolt * 0.6} />
      <StudioLights />
      <Head
        mouthOpen={0.05 + 0.6 * pulse(t, HICCUP_AT + 0.12, 0.22)}
        eyesWide={Math.max(0.15, smooth((t - HICCUP_AT) / 0.1) * (1 - smooth((t - HICCUP_AT - 1.2) / 0.6)))}
        position={[0, jolt * 0.55, 0]}
        rotation={[-0.04 - 0.12 * jolt, -0.15, 0]}
      />
      {[0, 0.12, 0.24].map((d) => {
        const k = t - HICCUP_AT - 0.1 - d;
        if (k < 0 || k > 0.7) return null;
        return (
          <mesh key={d} position={[0, -1.25 + jolt * 0.55, 3.3]} scale={1 + k * 7}>
            <torusGeometry args={[0.55, 0.05, 8, 48]} />
            <meshBasicMaterial color="#ffe14d" transparent opacity={1 - k / 0.7} />
          </mesh>
        );
      })}
      <mesh position={[0, -4.6, -0.3]}>
        <cylinderGeometry args={[1.5, 1.8, 3, 32]} />
        <meshStandardMaterial color="#e2ab90" roughness={0.65} />
      </mesh>
      <mesh position={[0, -7.4, -0.5]} scale={[1.9, 0.9, 1]}>
        <sphereGeometry args={[3.2, 48, 32]} />
        <meshStandardMaterial color="#5f7d9a" roughness={0.9} />
      </mesh>
    </>
  );
};
