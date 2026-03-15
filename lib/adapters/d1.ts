import type { Db, DbStatement } from "../backend";
import { SCHEMA, MIGRATIONS } from "../db-schema";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<unknown>;
}

let _migrated = false;

export function createD1Db(binding: unknown): Db {
  const d1 = binding as D1Database;

  if (!_migrated) {
    _migrated = true;
    d1.exec(SCHEMA).catch(() => {/* tables already exist */});
    for (const sql of MIGRATIONS) {
      d1.exec(sql).catch(() => {/* column already exists */});
    }
  }

  return {
    prepare(sql: string): DbStatement {
      return {
        async get<T>(...params: unknown[]): Promise<T | undefined> {
          const stmt = d1.prepare(sql);
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          const result = await bound.first<T>();
          return result ?? undefined;
        },
        async all<T>(...params: unknown[]): Promise<T[]> {
          const stmt = d1.prepare(sql);
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          const { results } = await bound.all<T>();
          return results;
        },
        async run(...params: unknown[]): Promise<void> {
          const stmt = d1.prepare(sql);
          const bound = params.length > 0 ? stmt.bind(...params) : stmt;
          await bound.run();
        },
      };
    },
    async exec(sql: string): Promise<void> {
      await d1.exec(sql);
    },
  };
}
