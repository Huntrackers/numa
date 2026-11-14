import { describe, it, expect } from 'vitest';
import vectors from './fixtures/goal-vectors.json';
import { allocateGoals, type Goal } from '../packages/domain/src/index.js';
describe('shared TypeScript/Rust savings vectors', () => {
  for (const v of vectors)
    it(v.name, () => {
      const result = allocateGoals(v.total, v.budget, v.goals as Goal[]);
      expect(result.contributions.map((g) => [g.goalId, g.amount])).toEqual(v.expected);
      expect(BigInt(result.reserved) + BigInt(result.cash)).toBe(BigInt(v.budget));
    });
});
