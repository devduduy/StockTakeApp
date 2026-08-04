import { computed, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiEnvelope, LoginResponse } from '../models/api.models';

const SESSION_KEY = 'hero-stock-take-session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSignal = signal<LoginResponse | null>(this.restoreSession());

  readonly session = this.sessionSignal.asReadonly();
  readonly user = computed(() => this.sessionSignal()?.user ?? null);
  readonly token = computed(() => this.sessionSignal()?.accessToken ?? null);
  readonly authenticated = computed(() => Boolean(this.token()));

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router
  ) {}

  login(username: string, password: string): Observable<ApiEnvelope<LoginResponse>> {
    return this.http
      .post<ApiEnvelope<LoginResponse>>('/api/auth/login', { username, password })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  logout(redirect = true): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.sessionSignal.set(null);
    if (redirect) {
      void this.router.navigate(['/login']);
    }
  }

  private storeSession(session: LoginResponse): void {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.sessionSignal.set(session);
  }

  private restoreSession(): LoginResponse | null {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as LoginResponse;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  }
}
