import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, EMPTY, filter, interval, map, merge, of, Subject, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { StockTakeRealtimeEvent, StockTakeRealtimeService } from '../../core/api/stock-take-realtime.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, DashboardScheduleProgress, DashboardSnapshot } from '../../core/models/api.models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly realtime = inject(StockTakeRealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshRequest = new Subject<void>();

  readonly snapshot = signal<DashboardSnapshot | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly errorMessage = signal('');
  readonly lastUpdated = signal<Date | null>(null);
  readonly realtimeStatus = signal<'connecting' | 'live' | 'fallback'>('connecting');
  readonly lastRealtimeEvent = signal<StockTakeRealtimeEvent | null>(null);
  readonly locationCount = computed(
    () => new Set(this.snapshot()?.schedules.map((schedule) => schedule.locCode) ?? []).size
  );
  readonly scanProgress = computed(() => {
    const data = this.snapshot();
    if (!data || data.totalRacks === 0) return 0;
    return Math.round((data.submittedRacks / data.totalRacks) * 100);
  });
  readonly confirmProgress = computed(() => {
    const data = this.snapshot();
    if (!data || data.totalRacks === 0) return 0;
    return Math.round((data.confirmedRacks / data.totalRacks) * 100);
  });
  readonly attentionSchedules = computed(() =>
    (this.snapshot()?.scheduleProgress ?? [])
      .filter((item) =>
        !item.sohReady ||
        item.waitingConfirmRacks > 0 ||
        item.discrepancyRacks > 0 ||
        item.rejectedRacks > 0 ||
        item.emptyRacks > 0
      )
      .slice(0, 5)
  );

  constructor() {
    const realtimeRefresh$ = this.realtime.stockTakeEvents().pipe(
      tap((event) => {
        if (event.type === 'stream.error') {
          this.realtimeStatus.set('fallback');
          return;
        }
        this.realtimeStatus.set('live');
        this.lastRealtimeEvent.set(event);
      }),
      filter((event) => event.type !== 'connected' && event.type !== 'stream.error'),
      debounceTime(600),
      map(() => undefined),
      catchError(() => {
        this.realtimeStatus.set('fallback');
        return EMPTY;
      })
    );

    const fallbackRefresh$ = interval(60_000).pipe(
      filter(() => this.realtimeStatus() !== 'live'),
      map(() => undefined)
    );

    merge(of(undefined), realtimeRefresh$, fallbackRefresh$, this.refreshRequest)
      .pipe(
        tap(() => {
          this.errorMessage.set('');
          this.snapshot() ? this.refreshing.set(true) : this.loading.set(true);
        }),
        switchMap(() =>
          this.api.getDashboardSnapshot().pipe(
            catchError((error: unknown) => {
              this.errorMessage.set(apiErrorMessage(error, 'Dashboard gagal dimuat.'));
              return EMPTY;
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((snapshot) => {
        this.snapshot.set(snapshot);
        this.loading.set(false);
        this.refreshing.set(false);
        this.lastUpdated.set(new Date());
      });
  }

  refresh(): void {
    if (!this.refreshing()) this.refreshRequest.next();
  }

  statusLabel(status: string): string {
    return ({ DRAFT: 'Draft', OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CLOSED: 'Closed' } as Record<string, string>)[status] || status;
  }

  stockTypeLabel(code: string): string {
    return code.includes('PARTIAL') ? 'PARTIAL' : 'ALL';
  }

  realtimeStatusLabel(): string {
    return {
      connecting: 'SSE · Menghubungkan',
      live: 'SSE · LIVE',
      fallback: 'Fallback · 60 DETIK',
    }[this.realtimeStatus()];
  }

  scheduleDateRange(schedule: ActiveSchedule): string {
    if (schedule.startDate === schedule.endDate) return schedule.startDate;
    return `${schedule.startDate} - ${schedule.endDate}`;
  }

  attentionLabel(item: DashboardScheduleProgress): string {
    if (!item.sohReady) return 'SOH belum digenerate';
    if (item.rejectedRacks > 0) return `${item.rejectedRacks} rack rejected`;
    if (item.discrepancyRacks > 0) return `${item.discrepancyRacks} rack selisih`;
    if (item.waitingConfirmRacks > 0) return `${item.waitingConfirmRacks} rack menunggu confirm`;
    if (item.emptyRacks > 0) return `${item.emptyRacks} rack belum scan`;
    return 'Dalam kontrol';
  }
}
