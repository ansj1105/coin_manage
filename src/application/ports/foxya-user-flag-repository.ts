export interface FoxyaUserFlagRepository {
  isTestUser(userId: string): Promise<boolean>;
}
