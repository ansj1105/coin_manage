import { Pool } from 'pg';
import type { FoxyaUserFlagRepository } from '../../application/ports/foxya-user-flag-repository.js';

type FoxyaUserFlagRow = {
  is_test: number | null;
};

export class PostgresFoxyaUserFlagRepository implements FoxyaUserFlagRepository {
  constructor(private readonly pool: Pool) {}

  async isTestUser(userId: string): Promise<boolean> {
    const result = await this.pool.query<FoxyaUserFlagRow>(
      `
        select is_test
        from users
        where id = $1
          and deleted_at is null
        limit 1
      `,
      [userId]
    );

    const row = result.rows[0];
    return row?.is_test === 1;
  }
}

export class InMemoryFoxyaUserFlagRepository implements FoxyaUserFlagRepository {
  private readonly flags = new Map<string, boolean>();

  setTestUser(userId: string, isTest: boolean) {
    this.flags.set(userId, isTest);
  }

  async isTestUser(userId: string): Promise<boolean> {
    return this.flags.get(userId) ?? false;
  }
}
