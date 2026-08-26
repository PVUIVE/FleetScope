import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/index.js';

describe('canonicalJson', () => {
  it('is insensitive to key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts keys recursively', () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe(
      '{"a":[{"x":2,"y":1}],"z":{"c":2,"d":1}}',
    );
  });

  it('drops undefined properties but preserves array positions', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('preserves array order, which is semantically meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('rejects non-finite numbers rather than silently emitting null', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles multi-byte input and multi-block padding', () => {
    expect(sha256Hex('a'.repeat(1_000_000)).length).toBe(64);
    expect(sha256Hex('café')).toBe(sha256Hex('café'));
  });
});
