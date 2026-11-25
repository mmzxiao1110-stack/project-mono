/**
 * Timers that shouldn't keep Node alive on their own. Node's timers have
 * unref(); Cloudflare's return plain numbers, so it's optional.
 */
export const unref = (t) => { t?.unref?.(); return t; };
