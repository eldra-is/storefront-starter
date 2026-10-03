import { describe, expect, it } from 'vitest';
import { recoveryOutcome } from '../../app/utils/recovery';

describe('recoveryOutcome', () => {
  it('is restored when every item came back', () => {
    expect(recoveryOutcome({ restored: 3, missing: 0 })).toBe('restored');
  });

  it('is partial when anything is missing, even if nothing came back', () => {
    expect(recoveryOutcome({ restored: 2, missing: 1 })).toBe('partial');
    expect(recoveryOutcome({ restored: 0, missing: 2 })).toBe('partial');
  });

  it('is expired only when nothing came back and nothing is missing', () => {
    expect(recoveryOutcome({ restored: 0, missing: 0 })).toBe('expired');
  });
});
