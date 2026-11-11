// Imported first by the UI entry. zod 4 probes for JIT support with `Function('')`, which the CSP
// (`script-src 'self'`) blocks and reports on every page load. jitless skips the probe; schemas and results are
// unchanged (spike-browser-host.md, surprise 1).
import { z } from 'zod';

z.config({ jitless: true });
