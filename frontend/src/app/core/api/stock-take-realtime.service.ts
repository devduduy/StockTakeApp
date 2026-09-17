import { Injectable, NgZone, inject } from '@angular/core';
import { Observable, EMPTY } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export type StockTakeRealtimeEventType =
  | 'connected'
  | 'stream.error'
  | 'schedule.created'
  | 'schedule.updated'
  | 'schedule.closed'
  | 'schedule.team.updated'
  | 'rack.master.created'
  | 'rack.master.updated'
  | 'rack.master.deleted'
  | 'rack.scope.updated'
  | 'rack.scanned'
  | 'rack.manual_scanned'
  | 'rack.scan_deleted'
  | 'rack.printed'
  | 'rack.corrected'
  | 'rack.confirmed'
  | 'rack.rejected'
  | 'soh.generated';

export interface StockTakeRealtimeEvent {
  type: StockTakeRealtimeEventType;
  scheduleId?: number;
  rackId?: number;
  locCode?: string;
  username?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class StockTakeRealtimeService {
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  stockTakeEvents(): Observable<StockTakeRealtimeEvent> {
    const token = this.auth.token();
    if (!token) return EMPTY;

    return new Observable<StockTakeRealtimeEvent>((observer) => {
      const source = new EventSource(`/api/stock-take/events?token=${encodeURIComponent(token)}`);

      source.addEventListener('stock-take', (event) => {
        this.zone.run(() => {
          try {
            observer.next(JSON.parse((event as MessageEvent<string>).data) as StockTakeRealtimeEvent);
          } catch {
            observer.next({ type: 'stream.error', occurredAt: new Date().toISOString() });
          }
        });
      });

      source.onerror = () => {
        this.zone.run(() => {
          observer.next({ type: 'stream.error', occurredAt: new Date().toISOString() });
        });
      };

      return () => source.close();
    });
  }
}
