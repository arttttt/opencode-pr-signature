/**
 * `./server` export: the entry OpenCode 1.3.4+ and OpenCode 2 load first.
 *
 * One object module serves both: OpenCode 1 reads `id` + `server` and never
 * calls `setup`; OpenCode 2 requires an object with `id` + `setup` and
 * ignores `server`. OpenCode 1.0 – 1.3.3 never look here — they import the
 * package root, entry/legacy.ts.
 */

import { openCodeV1Plugin, openCodeV2Setup, PLUGIN_ID } from "../composition";

export default {
  id: PLUGIN_ID,
  server: openCodeV1Plugin,
  setup: openCodeV2Setup,
};
