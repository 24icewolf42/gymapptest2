import { describe, it, expect } from 'vitest';
import { isNewer, parseRelease, releaseIsNewer } from '../../js/domain/release.js';

describe('update checks', () => {
  it('compares versions with or without a v prefix', () => {
    expect(isNewer('3.0.1', '3.0.0')).toBe(true);
    expect(isNewer('v3.1.0', '3.0.9')).toBe(true);
    expect(isNewer('3.0.0', '3.0.0')).toBe(false);
    expect(isNewer('2.12.0', '3.0.0')).toBe(false);
  });

  it('reads the release title', () => {
    expect(parseRelease('Tracker v3.0.1 (build 57)')).toEqual({ version: '3.0.1', build: 57 });
    expect(parseRelease('Rat Tracker v2.9.1')).toEqual({ version: '2.9.1', build: null });
    expect(parseRelease(null)).toEqual({ version: null, build: null });
  });

  it('decides by build number when both are known, else by version', () => {
    expect(releaseIsNewer({ version: '3.0.0', build: 58 }, { version: '3.0.0', build: 57 })).toBe(true);
    expect(releaseIsNewer({ version: '3.0.1', build: 56 }, { version: '3.0.0', build: 57 })).toBe(false);
    expect(releaseIsNewer({ version: '3.0.1', build: null }, { version: '3.0.0', build: 57 })).toBe(true);
    expect(releaseIsNewer({ version: null, build: null }, { version: '3.0.0', build: null })).toBe(false);
  });
});
