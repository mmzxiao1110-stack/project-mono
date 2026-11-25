/* global __APP_VERSION__ */
/** The game's version (package.json), shown beside every title. Bump it with each release. */
export const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
export const VERSION_LABEL = `v${VERSION}`;
