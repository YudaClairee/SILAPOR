import { describe, expect, it } from 'vitest';
import { SEED_USERS } from './seed.js';

describe('seed users', () => {
  it('includes the dedicated managerial account', () => {
    expect(SEED_USERS).toContainEqual({
      username: 'manajerial',
      role: 'MANAGERIAL',
      nim: null,
      externalUserId: 'manajerial',
    });
  });
});
