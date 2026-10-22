import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** D1-compatible adapter; production and local dev use the same queries. */
export function database(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations(tag TEXT PRIMARY KEY, hash TEXT NOT NULL)');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) {
    const schema = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
    const digest = createHash('sha256').update(schema).digest('hex');
    const applied = sqlite.prepare('SELECT hash FROM _local_migrations WHERE tag=?').get(entry.tag);
    if (applied) {
      if (applied.hash !== digest) throw new Error(`Applied migration ${entry.tag} changed; append a new migration instead`);
      continue;
    }
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(schema);
      sqlite.prepare('INSERT INTO _local_migrations(tag,hash) VALUES(?,?)').run(entry.tag, digest);
      sqlite.exec('COMMIT');
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  }
  function prepare(sql) {
    let params = [];
    const statement = sqlite.prepare(sql);
    const prepared = {
      bind(...values) { params = values; return prepared; },
      async first() { return statement.get(...params) || null; },
      async all() { return { results: statement.all(...params), success: true }; },
      async run() { const result = statement.run(...params); return { meta: { changes: Number(result.changes) }, success: true }; },
    };
    return prepared;
  }
  return { prepare, close: () => sqlite.close(), sqlite };
}
