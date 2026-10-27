import { describe, expect, it } from 'vitest';

import {
  assertProtocolVersion,
  isProtocolVersionCompatible,
  parseBrainResponse,
  parsePageState,
  PROTOCOL_MAJOR,
  PROTOCOL_VERSION,
  ProtocolError,
} from '../errors';
import { checkoutPageState, brainResponseFillThree } from '../fixtures';

describe('PROTOCOL_VERSION', () => {
  it('is the frozen 1.x contract', () => {
    expect(PROTOCOL_VERSION).toBe('1.0.0');
    expect(PROTOCOL_MAJOR).toBe(1);
  });
});

describe('parsePageState', () => {
  it('returns the parsed state', () => {
    expect(parsePageState(checkoutPageState).urlOrAppTitle).toBe('Checkout — Acme');
  });

  it('throws a ProtocolError with flattened issue paths', () => {
    let caught: unknown;
    try {
      parsePageState({ urlOrAppTitle: 'x', elements: [{ id: 1 }] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProtocolError);
    const error = caught as ProtocolError;
    expect(error.code).toBe('INVALID_PAGE_STATE');
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues.some((issue) => issue.path.startsWith('elements.0'))).toBe(true);
    expect(error.message).toContain('issue(s)');
  });

  it('uses (root) for issues without a path', () => {
    let caught: ProtocolError | undefined;
    try {
      parsePageState(null);
    } catch (error) {
      caught = error as ProtocolError;
    }
    expect(caught?.issues[0]?.path).toBe('(root)');
  });
});

describe('parseBrainResponse', () => {
  it('returns the parsed response', () => {
    expect(parseBrainResponse(brainResponseFillThree).actions).toHaveLength(3);
  });

  it('throws with paths like actions', () => {
    let caught: ProtocolError | undefined;
    try {
      parseBrainResponse({});
    } catch (error) {
      caught = error as ProtocolError;
    }
    expect(caught?.code).toBe('INVALID_BRAIN_RESPONSE');
    expect(caught?.issues.length).toBeGreaterThan(0);
    expect(caught?.issues.some((issue) => issue.path === 'actions')).toBe(true);
  });
});

describe('ProtocolError', () => {
  it('is a named Error with a default empty issue list', () => {
    const error = new ProtocolError('UNSUPPORTED_VERSION', 'nope');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProtocolError');
    expect(error.issues).toEqual([]);
    expect(error.code).toBe('UNSUPPORTED_VERSION');
  });
});

describe('protocol version compatibility', () => {
  it.each(['1.0.0', '1.4.0', '1.99.3'])('accepts %s', (version) => {
    expect(isProtocolVersionCompatible(version)).toBe(true);
  });

  it.each(['2.0.0', '0.9.0', '1.0', 'v1.0.0', '', 'not-a-version'])('rejects %s', (version) => {
    expect(isProtocolVersionCompatible(version)).toBe(false);
  });

  it('throws UNSUPPORTED_VERSION for a mismatched major', () => {
    expect(() => assertProtocolVersion('2.0.0')).toThrow(ProtocolError);
    try {
      assertProtocolVersion('2.0.0');
    } catch (error) {
      expect((error as ProtocolError).code).toBe('UNSUPPORTED_VERSION');
    }
  });

  it('accepts a matching major', () => {
    expect(() => assertProtocolVersion('1.2.3')).not.toThrow();
  });
});
