import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorEnvelope } from '../models/api.models';

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }
  const payload = error.error as ApiErrorEnvelope | undefined;
  return payload?.error?.message || (error.status === 0 ? 'Backend tidak dapat dihubungi.' : fallback);
}
