// Abertura do SQLite (node:sqlite, embutido no Node 24 / Electron 44) e migrações seguras.
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './schema';

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function checksum(m: Migration): string {
  return createHash('sha256').update(`${m.version}\n${m.name}\n${m.sql}`).digest('hex');
}

export interface OpenOptions {
  migrations?: readonly Migration[];
  /** Relógio injetável (nome do backup). */
  now?: () => number;
}

/** Abre o banco com WAL + synchronous=FULL e aplica as migrações pendentes (com backup prévio). */
export function openDatabase(dbPath: string, opts: OpenOptions = {}): DatabaseSync {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (dbPath !== ':memory:') {
      const mode = (db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string }).journal_mode;
      if (mode.toLowerCase() !== 'wal') throw new Error(`SQLite não aceitou WAL (modo: ${mode})`);
    }
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA journal_size_limit = 16777216');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA trusted_schema = OFF');
    const sync = (db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous;
    if (sync !== 2) throw new Error('synchronous=FULL não aplicado');
    migrate(db, dbPath, opts.migrations ?? MIGRATIONS, opts.now ?? Date.now);
    return db;
  } catch (e) {
    try { db.close(); } catch { /* já fechado */ }
    throw e;
  }
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

export function migrate(db: DatabaseSync, dbPath: string, migrations: readonly Migration[], now: () => number): void {
  const current = userVersion(db);
  const latest = migrations.reduce((a, m) => Math.max(a, m.version), 0);
  if (current > latest) {
    throw new MigrationError(`o banco é da versão ${current}, mais nova que este app (${latest}); não vou rebaixar`);
  }
  // valida as migrações já aplicadas (imutáveis)
  if (current > 0) {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get();
    if (!hasTable) throw new MigrationError('banco versionado sem schema_migrations; não vou abrir');
    const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as
      { version: number; checksum: string }[];
    for (const r of rows) {
      const def = migrations.find((m) => m.version === r.version);
      if (!def) throw new MigrationError(`migração ${r.version} aplicada mas desconhecida`);
      if (checksum(def) !== r.checksum) throw new MigrationError(`migração ${r.version} foi alterada depois de aplicada`);
    }
  }
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;
  if (current > 0 && dbPath !== ':memory:') {
    // backup consistente antes de alterar um banco existente
    const target = `${dbPath}.bak-v${current}-${now()}`;
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  // todas as pendentes numa única transação: falhou uma, nenhuma vale
  db.exec('BEGIN IMMEDIATE');
  let last = current;
  try {
    for (const m of pending) {
      last = m.version;
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?,?,?,?)')
        .run(m.version, m.name, checksum(m), now());
    }
    db.exec(`PRAGMA user_version = ${last}`);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já revertido */ }
    throw new MigrationError(`migração ${last} falhou: ${(e as Error).message}`);
  }
}

/** Abertura só de leitura para diagnóstico: não migra, não mexe no fence, não derruba o core vivo. */
export function openReadOnly(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
