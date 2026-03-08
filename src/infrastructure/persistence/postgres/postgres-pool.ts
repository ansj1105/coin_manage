import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { env } from '../../../config/env.js';
import type { KorionDatabase } from './db-schema.js';

export const createPostgresPool = (): Pool => {
  return new Pool({
    host: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    max: 10
  });
};

export const createPostgresDb = (pool: Pool): Kysely<KorionDatabase> => {
  return new Kysely<KorionDatabase>({
    dialect: new PostgresDialect({ pool })
  });
};
