import { Pool } from 'pg';
import { env } from '../../../config/env.js';

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
