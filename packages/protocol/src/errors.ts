import type { z } from 'zod';

import { BrainResponseSchema, type BrainResponse } from './brain';
import { PageStateSchema, type PageState } from './page-state';

export const PROTOCOL_VERSION = '1.0.0';
export const PROTOCOL_MAJOR = 1;

export type ProtocolErrorCode =
  'INVALID_PAGE_STATE' | 'INVALID_BRAIN_RESPONSE' | 'UNSUPPORTED_VERSION';

export interface ProtocolIssue {
  path: string;
  message: string;
}

/** Typed, greppable protocol failure carrying flattened zod issues. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly issues: ProtocolIssue[];

  constructor(code: ProtocolErrorCode, message: string, issues: ProtocolIssue[] = []) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.issues = issues;
  }
}

function parseOrThrow<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  code: ProtocolErrorCode,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ProtocolError(
      code,
      `Protocol validation failed with ${result.error.issues.length} issue(s)`,
      result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Parse a page state or throw a `ProtocolError` with `issues`. */
export function parsePageState(input: unknown): PageState {
  return parseOrThrow(PageStateSchema, 'INVALID_PAGE_STATE', input);
}

/** Parse a brain response or throw a `ProtocolError` with `issues`. */
export function parseBrainResponse(input: unknown): BrainResponse {
  return parseOrThrow(BrainResponseSchema, 'INVALID_BRAIN_RESPONSE', input);
}

/**
 * True when `version` shares the protocol major version (`1.x.y`).
 * Malformed versions are treated as incompatible — fail closed.
 */
export function isProtocolVersionCompatible(version: string): boolean {
  const major = /^(\d+)\.\d+\.\d+$/.exec(version)?.[1];
  return major !== undefined && Number(major) === PROTOCOL_MAJOR;
}

/** Throw `UNSUPPORTED_VERSION` unless the client speaks protocol major 1. */
export function assertProtocolVersion(version: string): void {
  if (!isProtocolVersionCompatible(version)) {
    throw new ProtocolError(
      'UNSUPPORTED_VERSION',
      `Client protocol version ${version} is not compatible with ${PROTOCOL_VERSION}`,
    );
  }
}
