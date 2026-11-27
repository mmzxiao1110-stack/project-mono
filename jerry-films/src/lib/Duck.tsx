import { C } from "./style";

// Rubber duck built from primitives. Faces +x. `squash` 0..1 flattens it.
export const Duck: React.FC<{
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  squash?: number;
}> = ({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, squash = 0 }) => {
  const sq: [number, number, number] = [
    scale * (1 + squash * 0.45),
    scale * (1 - squash * 0.55),
    scale * (1 + squash * 0.45),
  ];
  const rubber = { color: C.duck, roughness: 0.32, metalness: 0 };
  return (
    <group position={position} rotation={rotation} scale={sq}>
      <mesh castShadow scale={[1.3, 0.82, 1]}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshStandardMaterial {...rubber} />
      </mesh>
      <mesh castShadow position={[-1.15, 0.42, 0]} rotation={[0, 0, 0.9]} scale={[1, 1, 0.8]}>
        <coneGeometry args={[0.38, 0.7, 24]} />
        <meshStandardMaterial {...rubber} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[-0.15, 0.12, s * 0.78]} scale={[0.72, 0.42, 0.28]} rotation={[0, 0, 0.15]}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial {...rubber} />
        </mesh>
      ))}
      <mesh castShadow position={[0.62, 1.0, 0]}>
        <sphereGeometry args={[0.64, 48, 32]} />
        <meshStandardMaterial {...rubber} />
      </mesh>
      <mesh castShadow position={[1.22, 0.88, 0]} scale={[1.25, 0.42, 0.95]}>
        <sphereGeometry args={[0.32, 32, 24]} />
        <meshStandardMaterial color={C.beak} roughness={0.35} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[1.0, 1.2, s * 0.33]}>
          <mesh>
            <sphereGeometry args={[0.1, 20, 16]} />
            <meshStandardMaterial color="#111" roughness={0.2} />
          </mesh>
          <mesh position={[0.06, 0.04, s * 0.03]}>
            <sphereGeometry args={[0.03, 12, 8]} />
            <meshBasicMaterial color="#fff" />
          </mesh>
        </group>
      ))}
    </group>
  );
};
