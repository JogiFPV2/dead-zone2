import type { ApiError, ApiErrorCode, SaveConflictError } from '@deadzone/protocol';

/** An expected API error: status code + stable machine code (docs/backend.md §5.1). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string = code,
    /** Extra fields of the error body (`issues`, `server` of `SaveConflictError`). */
    readonly details?: Omit<ApiError, 'error' | 'message'> | Pick<SaveConflictError, 'server'>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string): HttpError => new HttpError(400, 'bad_request', msg);
export const invalidEnvelope = (msg: string): HttpError =>
  new HttpError(400, 'invalid_envelope', msg);
export const invalidState = (msg: string): HttpError => new HttpError(422, 'invalid_state', msg);
export const notFound = (): HttpError =>
  new HttpError(404, 'character_not_found', 'character not found');
export const characterDead = (): HttpError =>
  new HttpError(409, 'character_dead', 'character is dead (permadeath)');
export const versionConflict = (): HttpError =>
  new HttpError(409, 'save_version_conflict', 'save version does not match, reopen the save');
export const accountGone = (): HttpError =>
  new HttpError(401, 'unauthorized', 'account no longer exists');
