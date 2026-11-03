// Copies the Pyodide runtime (Python compiled to WebAssembly) from node_modules
// into public/pyodide so it is served by our own site — no third-party CDN.
// Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = dirname(require.resolve('pyodide/package.json'));
const dest = join(process.cwd(), 'public', 'pyodide');
const files = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const from = join(src, file);
  if (!existsSync(from)) throw new Error(`Pyodide file missing: ${from}`);
  cpSync(from, join(dest, file));
}
console.log(`Copied Pyodide runtime to ${dest}`);
