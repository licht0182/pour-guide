import { describe, expect, it } from 'vitest';
import { DriveAuthError, driveResponseError } from './driveErrors';

describe('Google Drive failure diagnosis', () => {
  it('identifies a disabled API without discarding the login session', async () => {
    for (const error of [
      { errors: [{ reason: 'accessNotConfigured' }] },
      { details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'drive.googleapis.com' } }] },
      { message: 'Google Drive API has not been used in project 13512728967 before or it is disabled.' },
    ]) {
      const result = await driveResponseError(Response.json({ error }, { status: 403 }));
      expect(result.message).toContain('Drive API가 꺼져');
      expect(result).not.toBeInstanceOf(DriveAuthError);
    }
  });
  it('requires reauthorization only for invalid credentials or missing scope', async () => {
    expect(await driveResponseError(new Response('', { status: 401 }))).toBeInstanceOf(DriveAuthError);
    expect(await driveResponseError(Response.json({ error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, { status: 403 }))).toBeInstanceOf(DriveAuthError);
  });
  it('distinguishes organization, quota and storage errors from authentication', async () => {
    for (const [reason, text] of [['domainPolicy', '조직 정책'], ['rateLimitExceeded', '요청 한도'], ['storageQuotaExceeded', '저장 공간']]) {
      const result = await driveResponseError(Response.json({ error: { errors: [{ reason }] } }, { status: 403 }));
      expect(result.message).toContain(text);
      expect(result).not.toBeInstanceOf(DriveAuthError);
    }
  });
  it('handles empty, malformed and unexpected responses without exposing the raw body', async () => {
    for (const body of ['', 'not json', 'null', '{"error":null}', '{"error":{"details":[null,{}]}}']) {
      const result = await driveResponseError(new Response(body, { status: 503 }));
      expect(result.message).toContain('503');
      expect(result).not.toBeInstanceOf(DriveAuthError);
    }
  });
});
