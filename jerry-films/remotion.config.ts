import { Config } from "@remotion/cli/config";

// Software WebGL so renders work on machines with no GPU (cloud boxes, CI).
Config.setChromiumOpenGlRenderer("swangle");
Config.setConcurrency(2);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
