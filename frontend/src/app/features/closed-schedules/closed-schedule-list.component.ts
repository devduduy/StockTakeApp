import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, interval, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule } from '../../core/models/api.models';

@Component({
  selector: 'app-closed-schedule-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './closed-schedule-list.component.html',
  styleUrl: './closed-schedule-list.component.scss'
})
export class ClosedScheduleListComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly schedules = signal<ActiveSchedule[]>([]);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly typeFilter = signal<'ALL' | 'PARTIAL' | ''>('');

  readonly closedSchedules = computed(() =>
    this.schedules().filter((schedule) => ['CLOSED', 'COMPLETED'].includes(schedule.status))
  );

  readonly filteredSchedules = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    return this.closedSchedules().filter((schedule) => {
      const stockType = this.stockTypeLabel(schedule);
      const matchesType = !type || stockType === type;
      const matchesKeyword = !keyword || [
        schedule.scheduleNo,
        schedule.scheduleDesc,
        schedule.locCode,
        schedule.location.name,
        schedule.status
      ].some((value) => value.toLowerCase().includes(keyword));
      return matchesType && matchesKeyword;
    });
  });

  constructor() {
    this.fetchSchedules(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    interval(30_000)
      .pipe(
        switchMap(() => this.fetchSchedules(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  refresh(): void {
    if (!this.refreshing()) this.fetchSchedules(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  setTypeFilter(type: 'ALL' | 'PARTIAL' | ''): void {
    this.typeFilter.set(type);
  }

  stockTypeLabel(schedule: ActiveSchedule): 'ALL' | 'PARTIAL' {
    return schedule.stockType.code.includes('PARTIAL') ? 'PARTIAL' : 'ALL';
  }

  statusLabel(status: string): string {
    return ({ CLOSED: 'Closed', COMPLETED: 'Completed' } as Record<string, string>)[status] || status;
  }

  private fetchSchedules(initial: boolean) {
    initial ? this.loading.set(true) : this.refreshing.set(true);
    this.errorMessage.set('');
    return this.api.getSchedules().pipe(
      tap((schedules) => {
        this.schedules.set(schedules);
        this.loading.set(false);
        this.refreshing.set(false);
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Schedule close gagal dimuat.'));
        this.loading.set(false);
        this.refreshing.set(false);
        return initial ? of([]) : EMPTY;
      })
    );
  }
}
