import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, interval, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule } from '../../core/models/api.models';

@Component({
  selector: 'app-schedule-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './schedule-list.component.html',
  styleUrl: './schedule-list.component.scss'
})
export class ScheduleListComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly schedules = signal<ActiveSchedule[]>([]);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly typeFilter = signal<'ALL' | 'PARTIAL' | ''>('');
  readonly filteredSchedules = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    return this.schedules().filter((schedule) => {
      const matchesKeyword = !keyword || [
        schedule.scheduleNo,
        schedule.scheduleDesc,
        schedule.location.name,
        schedule.locCode
      ].some((value) => value.toLowerCase().includes(keyword));
      const resolvedType = schedule.stockType.code.includes('PARTIAL') ? 'PARTIAL' : 'ALL';
      return matchesKeyword && (!type || resolvedType === type);
    });
  });

  constructor() {
    interval(30_000)
      .pipe(
        switchMap(() => this.fetchSchedules(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
    this.fetchSchedules(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  refresh(): void {
    if (!this.refreshing()) this.fetchSchedules(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  setTypeFilter(type: 'ALL' | 'PARTIAL' | ''): void {
    this.typeFilter.set(type);
  }

  statusLabel(status: string): string {
    return ({ OPEN: 'Terbuka', IN_PROGRESS: 'Berjalan', COMPLETED: 'Selesai' } as Record<string, string>)[status] || status;
  }

  stockTypeLabel(schedule: ActiveSchedule): 'ALL' | 'PARTIAL' {
    return schedule.stockType.code.includes('PARTIAL') ? 'PARTIAL' : 'ALL';
  }

  categorySummary(schedule: ActiveSchedule): string {
    if (this.stockTypeLabel(schedule) === 'ALL') return 'Semua kategori barang';
    if (schedule.categories.length === 0) return `${schedule.categoryIds.length} kategori terpilih`;
    const names = schedule.categories.slice(0, 2).map((category) => category.name).join(', ');
    const remaining = schedule.categories.length - 2;
    return remaining > 0 ? `${names} +${remaining} lainnya` : names;
  }

  private fetchSchedules(initial: boolean) {
    initial ? this.loading.set(true) : this.refreshing.set(true);
    this.errorMessage.set('');
    return this.api.getActiveSchedules().pipe(
      tap((schedules) => {
        this.schedules.set(schedules);
        this.loading.set(false);
        this.refreshing.set(false);
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Schedule gagal dimuat.'));
        this.loading.set(false);
        this.refreshing.set(false);
        return initial ? of([]) : EMPTY;
      })
    );
  }
}
