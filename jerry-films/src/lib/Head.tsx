import { C } from "./style";

// Stylised clay head facing +z. mouthOpen 0..1, eyesWide 0..1.
export const Head: React.FC<{
  mouthOpen?: number;
  eyesWide?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}> = ({ mouthOpen = 0, eyesWide = 0, position = [0, 0, 0], rotation = [0, 0, 0] }) => {
  const skin = { color: C.skin, roughness: 0.6 };
  const my = 0.18 + 0.82 * mouthOpen;
  return (
    <group position={position} rotation={rotation}>
      {/* skull + jaw */}
      <mesh castShadow receiveShadow scale={[1, 1.18, 1]}>
        <sphereGeometry args={[3, 64, 48]} />
        <meshStandardMaterial {...skin} />
      </mesh>
      <mesh castShadow position={[0, -1.6, 0.6]} scale={[0.85, 0.6, 0.8]}>
        <sphereGeometry args={[3, 48, 32]} />
        <meshStandardMaterial {...skin} />
      </mesh>
      {/* hair cap */}
      <mesh castShadow position={[0, 1.15, -0.25]} scale={[1.04, 0.85, 1.04]}>
        <sphereGeometry args={[3, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.42]} />
        <meshStandardMaterial color={C.hair} roughness={0.85} />
      </mesh>
      {/* ears */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 2.95, 0, 0]} scale={[0.35, 0.75, 0.5]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshStandardMaterial {...skin} />
        </mesh>
      ))}
      {/* eyes */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 1.05, 0.75, 2.55]}>
          <mesh scale={[1, 0.85 + 0.35 * eyesWide, 0.6]}>
            <sphereGeometry args={[0.5, 32, 24]} />
            <meshStandardMaterial color="#f6f1ea" roughness={0.25} />
          </mesh>
          <mesh position={[0, 0, 0.3]}>
            <sphereGeometry args={[0.22 - 0.06 * eyesWide, 24, 16]} />
            <meshStandardMaterial color="#2b1d14" roughness={0.15} />
          </mesh>
          {/* brow */}
          <mesh position={[0, 0.62 + 0.25 * eyesWide, 0.25]} rotation={[0, 0, s * (-0.15 + 0.2 * eyesWide)]} scale={[0.6, 0.1, 0.15]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color={C.hair} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* nose */}
      <mesh castShadow position={[0, -0.05, 3.05]} scale={[0.75, 1, 0.9]}>
        <sphereGeometry args={[0.48, 32, 24]} />
        <meshStandardMaterial {...skin} />
      </mesh>
      {/* mouth */}
      <group position={[0, -1.25, 2.72]}>
        <mesh scale={[1.15, my * 0.85, 0.45]}>
          <sphereGeometry args={[0.85, 32, 24]} />
          <meshStandardMaterial color={C.mouth} roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.35 * my, 0.12]} scale={[0.8, 0.35 * my, 0.4]}>
          <sphereGeometry args={[0.8, 24, 16]} />
          <meshStandardMaterial color="#d25e6e" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.55 * my, 0.25]} scale={[1, 0.25 * Math.max(my, 0.4), 0.3]}>
          <boxGeometry args={[1.3, 0.6, 0.6]} />
          <meshStandardMaterial color="#f4efe6" roughness={0.3} />
        </mesh>
        <mesh castShadow position={[0, 0, 0.3]} scale={[1.18, 0.88 * my + 0.05, 1]}>
          <torusGeometry args={[0.92, 0.2, 20, 64]} />
          <meshStandardMaterial color={C.lip} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
};
