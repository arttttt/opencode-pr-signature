/**
 * Package root (`.` and `main`): the entry OpenCode 1.0 – 1.3.3 imports.
 *
 * Those loaders call EVERY export of this module as a plugin function, and
 * 1.0.x does not deduplicate them — so the default export is the only one.
 * Later OpenCode versions load entry/server.ts instead.
 */

import { openCodeV1Plugin } from "../composition";

export default openCodeV1Plugin;
