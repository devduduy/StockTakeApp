import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, interval, merge, of, Subject, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { DashboardSnapshot } from '../../core/models/api.models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshRequest = new Subject<void>();

  readonly snapshot = signal<DashboardSnapshot | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly errorMessage = signal('');
  readonly lastUpdated = signal<Date | null>(null);
  readonly locationCount = computed(
    () => new Set(this.snapshot()?.schedules.map((schedule) => schedule.locCode) ?? []).size
  );
  readonly overallProgress = computed(() => {
    const data = this.snapshot();
    if (!data || data.totalRacks === 0) return 0;
    return Math.round((data.submittedRacks / data.totalRacks) * 100);
  });

  constructor() {
    merge(of(undefined), interval(15_000), this.refreshRequest)
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
    return ({ OPEN: 'Open', IN_PROGRESS: 'Inprogress', COMPLETED: 'Completed' } as Record<string, string>)[status] || status;
  }

  stockTypeLabel(code: string): string {
    return code.includes('PARTIAL') ? 'PARTIAL' : 'ALL';
  }
}
