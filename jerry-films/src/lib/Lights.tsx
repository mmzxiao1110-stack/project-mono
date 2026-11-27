export const StudioLights: React.FC<{ warm?: boolean }> = ({ warm }) => (
  <>
    <hemisphereLight args={[warm ? "#ffd7cf" : "#e8f1ff", warm ? "#5a1a24" : "#3a4a5a", 0.9]} />
    <directionalLight
      castShadow
      position={[6, 10, 8]}
      intensity={2.2}
      color={warm ? "#ffe1d6" : "#fff6ea"}
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-12}
      shadow-camera-right={12}
      shadow-camera-top={12}
      shadow-camera-bottom={-12}
      shadow-bias={-0.0004}
    />
    <directionalLight position={[-8, 3, -6]} intensity={0.9} color="#b8d4ff" />
  </>
);
