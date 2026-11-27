import { useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";

// Sets the camera every frame from plain numbers, so each scene can drive
// its shot as a pure function of time.
export const CameraRig: React.FC<{
  pos: [number, number, number];
  look: [number, number, number];
  fov?: number;
  shake?: number;
  t?: number;
}> = ({ pos, look, fov = 35, shake = 0, t = 0 }) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const sx = shake * Math.sin(t * 71.3) * 0.15;
  const sy = shake * Math.sin(t * 53.7 + 1) * 0.15;
  camera.position.set(pos[0] + sx, pos[1] + sy, pos[2]);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.lookAt(look[0] + sx * 0.5, look[1] + sy * 0.5, look[2]);
  return null;
};
