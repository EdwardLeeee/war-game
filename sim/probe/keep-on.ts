// Runs another entry script (argv[2]) with KEEP on (D-100), the rest of argv passed on.
import { KEEP } from "../src/core/rules.ts";
KEEP.on = true;
const script = process.argv[2];
process.argv.splice(2, 1);
await import(`../${script}`);
