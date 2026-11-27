import { useCurrentFrame } from "remotion";
import { CameraRig } from "../lib/CameraRig";
import { Duck } from "../lib/Duck";
import { Head } from "../lib/Head";
import { StudioLights } from "../lib/Lights";
import { FPS, pulse, smooth } from "../lib/style";

// Hook: a duck sails toward an open mouth and gets gulped.
export const Swallow: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const fly = smooth((t - 0.3) / 2.2);
  const gulpT = 2.55;
  const mouth = t < gulpT ? smooth(t / 0.9) : Math.max(0, 1 - (t - gulpT) * 5);
  const bump = pulse(t, gulpT + 0.25, 0.25);
  const duckPos: [number, number, number] = [
    1.6 * (1 - fly),
    -1.25 + 1.4 * Math.sin(Math.PI * fly) * (1 - fly) + 0.6 * (1 - fly),
    2.9 + 8 * (1 - fly),
  ];
  const duckScale = t < gulpT ? 0.55 - 0.25 * fly : 0;
  const push = smooth(t / 3.2);
  return (
    <>
      <CameraRig
        t={t}
        pos={[2.2 - 1.4 * push, 0.6 - 0.9 * push, 26 - 9 * push]}
        look={[0, -0.6 - 0.3 * push, 0]}
        fov={34}
      />
      <StudioLights />
      <Head mouthOpen={mouth} eyesWide={smooth((t - 1.2) / 0.6)} position={[0, bump * 0.25, 0]} rotation={[-0.05, 0.12, 0]} />
      {duckScale > 0 && (
        <Duck position={duckPos} rotation={[0.3, -Math.PI / 2 + t * 1.6, 0.4 * Math.sin(t * 3)]} scale={duckScale} />
      )}
      {/* neck + shoulders so the head isn't floating */}
      <mesh position={[0, -4.6, -0.3]} receiveShadow>
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
