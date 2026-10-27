import { describe, expect, it } from 'vitest';

import * as protocol from '../index';

describe('public surface', () => {
  it('exports every schema and helper the tracks import', () => {
    const expected = [
      'ActionErrorCodeSchema',
      'ActionResultSchema',
      'ActionSchema',
      'AgentStatusSchema',
      'BrainResponseSchema',
      'ClientContextSchema',
      'ConversationTurnSchema',
      'FormElementSchema',
      'FormElementTypeSchema',
      'PageStateSchema',
      'ProcessCommandRequestSchema',
      'ProcessCommandResponseSchema',
      'PROTOCOL_MAJOR',
      'PROTOCOL_VERSION',
      'ProtocolError',
      'assertProtocolVersion',
      'isProtocolVersionCompatible',
      'parseBrainResponse',
      'parsePageState',
    ];
    for (const name of expected) {
      expect(protocol).toHaveProperty(name);
    }
  });

  it('exposes the frozen version', () => {
    expect(protocol.PROTOCOL_VERSION).toBe('1.0.0');
  });
});
