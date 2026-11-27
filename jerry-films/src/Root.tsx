import { Composition } from "remotion";
import timeline from "../public/timeline.json";
import { FPS, H, W } from "./lib/style";
import { JerryVideo } from "./Video";

export const Root: React.FC = () => (
  <Composition
    id="RubberDuck"
    component={JerryVideo}
    durationInFrames={Math.ceil(timeline.total * FPS)}
    fps={FPS}
    width={W}
    height={H}
  />
);
