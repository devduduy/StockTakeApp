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
  readonly selectedLocationCode = signal('ALL');
  readonly locationOptions = computed(() => {
    const locations = new Map<string, string>();
    for (const schedule of this.snapshot()?.schedules ?? []) {
      if (!locations.has(schedule.locCode)) {
        locations.set(schedule.locCode, schedule.location.name);
      }
    }

    return Array.from(locations, ([code, name]) => ({ code, name })).sort((left, right) =>
      `${left.name} ${left.code}`.localeCompare(`${right.name} ${right.code}`)
    );
  });
  readonly dashboardData = computed(() => {
    const data = this.snapshot();
    const selectedLocation = this.selectedLocationCode();
    if (!data || selectedLocation === 'ALL') return data;

    const scheduleProgress = data.scheduleProgress.filter((item) => item.schedule.locCode === selectedLocation);
    return this.buildDashboardSnapshot(scheduleProgress);
  });
  readonly locationCount = computed(
    () => new Set(this.dashboardData()?.schedules.map((schedule) => schedule.locCode) ?? []).size
  );
  readonly scanProgress = computed(() => {
    const data = this.dashboardData();
    if (!data || data.totalRacks === 0) return 0;
    return Math.round((data.submittedRacks / data.totalRacks) * 100);
  });
  readonly confirmProgress = computed(() => {
    const data = this.dashboardData();
    if (!data || data.totalRacks === 0) return 0;
    return Math.round((data.confirmedRacks / data.totalRacks) * 100);
  });
  readonly attentionSchedules = computed(() =>
    (this.dashboardData()?.scheduleProgress ?? [])
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
        if (
          this.selectedLocationCode() !== 'ALL' &&
          !snapshot.schedules.some((schedule) => schedule.locCode === this.selectedLocationCode())
        ) {
          this.selectedLocationCode.set('ALL');
        }
        this.snapshot.set(snapshot);
        this.loading.set(false);
        this.refreshing.set(false);
        this.lastUpdated.set(new Date());
      });
  }

  refresh(): void {
    if (!this.refreshing()) this.refreshRequest.next();
  }

  setLocationFilter(locationCode: string): void {
    this.selectedLocationCode.set(locationCode || 'ALL');
  }

  isConfirmComplete(progress: Pick<DashboardScheduleProgress, 'confirmProgress' | 'totalRacks'>): boolean {
    return progress.totalRacks > 0 && progress.confirmProgress >= 100;
  }

  attentionRouterLink(item: DashboardScheduleProgress): unknown[] {
    if (!item.sohReady) return ['/master-soh'];
    return ['/schedules', item.schedule.id, 'racks'];
  }

  attentionQueryParams(item: DashboardScheduleProgress): Record<string, string> | null {
    if (item.sohReady) return null;
    return {
      scheduleId: item.schedule.id,
      scheduleNo: item.schedule.scheduleNo,
      dateFrom: item.schedule.startDate,
      dateTo: item.schedule.endDate,
    };
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
    if (item.discrepancyRacks > 0) return `${item.discrepancyRacks} rack koreksi`;
    if (item.waitingConfirmRacks > 0) return `${item.waitingConfirmRacks} rack menunggu confirm`;
    if (item.emptyRacks > 0) return `${item.emptyRacks} rack belum scan`;
    return 'Dalam kontrol';
  }

  private buildDashboardSnapshot(scheduleProgress: DashboardScheduleProgress[]): DashboardSnapshot {
    return {
      schedules: scheduleProgress.map((item) => item.schedule),
      scheduleProgress,
      totalRacks: scheduleProgress.reduce((sum, item) => sum + item.totalRacks, 0),
      emptyRacks: scheduleProgress.reduce((sum, item) => sum + item.emptyRacks, 0),
      submittedRacks: scheduleProgress.reduce((sum, item) => sum + item.submittedRacks, 0),
      printedRacks: scheduleProgress.reduce((sum, item) => sum + item.printedRacks, 0),
      waitingConfirmRacks: scheduleProgress.reduce((sum, item) => sum + item.waitingConfirmRacks, 0),
      confirmedRacks: scheduleProgress.reduce((sum, item) => sum + item.confirmedRacks, 0),
      rejectedRacks: scheduleProgress.reduce((sum, item) => sum + item.rejectedRacks, 0),
      discrepancyRacks: scheduleProgress.reduce((sum, item) => sum + item.discrepancyRacks, 0),
      schedulesWithSoh: scheduleProgress.filter((item) => item.sohReady).length,
      schedulesWithoutSoh: scheduleProgress.filter((item) => !item.sohReady).length,
      totalLines: scheduleProgress.reduce((sum, item) => sum + item.totalLines, 0),
      totalQuantity: scheduleProgress.reduce((sum, item) => sum + item.totalQuantity, 0),
      finalQuantity: scheduleProgress.reduce((sum, item) => sum + item.finalQuantity, 0),
      discrepancyQuantity: scheduleProgress.reduce((sum, item) => sum + item.discrepancyQuantity, 0),
    };
  }
}
