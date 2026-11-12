export class DriveAuthError extends Error {}
export class DriveNetworkError extends Error {}

// Google uses 403 for project configuration and quota errors as well as permissions.
// Keep the session for errors that signing in again cannot fix.
export async function driveResponseError(response: Response): Promise<Error> {
  let data: unknown;
  try { data = await response.json(); } catch { data = null; }
  const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasons = [
    ...(Array.isArray(record.errors) ? record.errors : []),
    ...(Array.isArray(record.details) ? record.details : []),
  ].flatMap(item => item && typeof item === 'object' && typeof item.reason === 'string' ? [item.reason] : []);
  const message = typeof record.message === 'string' ? record.message : '';
  const has = (...values: string[]) => reasons.some(reason => values.includes(reason));
  if (has('accessNotConfigured', 'SERVICE_DISABLED', 'API_DISABLED') || /has not been used.*before|it is disabled|API.*not.*enabled/i.test(message)) {
    return new Error('Google Cloud 프로젝트에서 Google Drive API가 꺼져 있습니다. 현재 OAuth 클라이언트가 속한 프로젝트에서 Google Drive API를 사용 설정한 뒤 잠시 후 다시 확인해 주세요. (403 SERVICE_DISABLED)');
  }
  if (response.status === 401) return new DriveAuthError('Google 연결이 만료되었거나 유효하지 않습니다. 다시 연결해 주세요. (401)');
  if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') || /insufficient authentication scopes/i.test(message)) {
    return new DriveAuthError('Drive 앱 저장 공간 권한이 승인되지 않았습니다. 다시 연결해 요청한 Drive 권한을 허용해 주세요. (403 insufficientPermissions)');
  }
  if (has('domainPolicy', 'ORG_RESTRICTION_VIOLATION')) return new Error('Google 계정의 조직 정책이 Drive 연결을 차단했습니다. 조직 관리자에게 문의해 주세요. (403 domainPolicy)');
  if (response.status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED')) {
    return new Error(`Google Drive 요청 한도에 도달했습니다. 연결을 해제하지 말고 잠시 후 다시 확인해 주세요. (${response.status})`);
  }
  if (has('storageQuotaExceeded')) return new Error('Google Drive 저장 공간이 부족합니다. 공간을 확보한 뒤 다시 저장해 주세요. (403 storageQuotaExceeded)');
  if (response.status === 403) return new Error('Google Drive 접근이 거부되었습니다. Drive API 사용 설정과 계정의 접근 정책을 확인해 주세요. (403)');
  return new Error(`Drive 요청에 실패했습니다 (${response.status}). 변경 사항은 브라우저에 보관됩니다. 잠시 후 다시 시도해 주세요.`);
}
