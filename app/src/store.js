import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');

// A tiny append-safe JSON array store. Reads tolerate a missing file; writes are
// atomic (write to a temp file then rename) so a crash never leaves half a file.
// Each store instance serializes its own writes to avoid interleaving.

export class JsonStore {
  constructor(fileName) {
    this.file = join(DATA_DIR, fileName);
    this.tmp = this.file + '.tmp';
    this._chain = Promise.resolve();
  }

  async readAll() {
    try {
      const text = await readFile(this.file, 'utf8');
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  // mutator: (currentArray) => { result, next }  where `next` is the array to persist.
  // Returns `result`. Writes are queued so concurrent callers can't clobber each other.
  async update(mutator) {
    const run = this._chain.then(async () => {
      const cur = await this.readAll();
      const { result, next } = mutator(cur);
      if (next !== undefined) {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(this.tmp, JSON.stringify(next, null, 2), 'utf8');
        await rename(this.tmp, this.file);
      }
      return result;
    });
    // Keep the chain alive even if this op throws.
    this._chain = run.catch(() => {});
    return run;
  }
}
