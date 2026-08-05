import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, EMPTY, forkJoin, interval, of, switchMap, take, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, Rack, RackScan, ScheduleLocation } from '../../core/models/api.models';

@Component({
  selector: 'app-rack-monitoring',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './rack-monitoring.component.html',
  styleUrl: './rack-monitoring.component.scss'
})
export class RackMonitoringComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly scheduleId = this.route.snapshot.paramMap.get('scheduleId') ?? '';

  readonly schedule = signal<ActiveSchedule | null>(null);
  readonly scheduleLocation = signal<ScheduleLocation | null>(null);
  readonly racks = signal<Rack[]>([]);
  readonly scans = signal<RackScan[]>([]);
  readonly selectedRack = signal<Rack | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly scansLoading = signal(false);
  readonly printing = signal(false);
  readonly printConfirmRack = signal<Rack | null>(null);
  readonly errorMessage = signal('');
  readonly scanErrorMessage = signal('');
  readonly printMessage = signal('');
  readonly printErrorMessage = signal('');
  readonly search = signal('');
  readonly statusFilter = signal<'ALL' | 'EMPTY' | 'SUBMITTED' | 'PRINTED'>('ALL');
  readonly lastUpdated = signal<Date | null>(null);

  readonly filteredRacks = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.racks().filter((rack) => {
      const matchesKeyword = !keyword || [rack.rackCode, rack.rackName].some((value) => value.toLowerCase().includes(keyword));
      const matchesStatus = status === 'ALL'
        || (status === 'PRINTED' && rack.printed)
        || (status === 'SUBMITTED' && !rack.printed && rack.submittedLineCount > 0)
        || (status === 'EMPTY' && rack.submittedLineCount === 0);
      return matchesKeyword && matchesStatus;
    });
  });
  readonly submittedCount = computed(() => this.racks().filter((rack) => rack.submittedLineCount > 0).length);
  readonly printedCount = computed(() => this.racks().filter((rack) => rack.printed).length);
  readonly totalLines = computed(() => this.racks().reduce((sum, rack) => sum + rack.submittedLineCount, 0));
  readonly totalQuantity = computed(() => this.racks().reduce((sum, rack) => sum + rack.submittedQuantity, 0));
  readonly selectedQuantity = computed(() => this.scans().reduce((sum, scan) => sum + scan.scanQty, 0));
  readonly selectedPrintNo = computed(() => this.scans().find((scan) => !!scan.printNo)?.printNo ?? null);

  constructor() {
    interval(10_000)
      .pipe(
        switchMap(() => this.fetchPage(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
    this.fetchPage(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  refresh(): void {
    if (!this.refreshing()) this.fetchPage(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  selectRack(rack: Rack): void {
    this.selectedRack.set(rack);
    this.loadRackScans(rack.id);
  }

  closeDetail(): void {
    this.selectedRack.set(null);
    this.scans.set([]);
    this.scanErrorMessage.set('');
    this.printErrorMessage.set('');
  }

  openPrintConfirm(rack: Rack): void {
    if (rack.printed || rack.submittedLineCount === 0 || this.printing()) return;
    this.printErrorMessage.set('');
    this.printConfirmRack.set(rack);
  }

  closePrintConfirm(): void {
    if (!this.printing()) this.printConfirmRack.set(null);
  }

  confirmPrint(): void {
    const rack = this.printConfirmRack();
    if (!rack || this.printing()) return;
    this.printing.set(true);
    this.printErrorMessage.set('');
    this.printMessage.set('');
    this.api.printRack(this.scheduleId, rack.id)
      .pipe(
        switchMap((result) => {
          this.printMessage.set(`Rack ${rack.rackCode} berhasil diprint dengan nomor ${result.printNo}.`);
          this.printConfirmRack.set(null);
          return this.fetchPage(false);
        }),
        tap(() => {
          this.loadRackScans(rack.id, false);
          this.printing.set(false);
        }),
        catchError((error: unknown) => {
          this.printErrorMessage.set(apiErrorMessage(error, 'Rack gagal diprint.'));
          this.printing.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  setStatusFilter(status: 'ALL' | 'EMPTY' | 'SUBMITTED' | 'PRINTED'): void {
    this.statusFilter.set(status);
  }

  rackState(rack: Rack): 'printed' | 'submitted' | 'empty' {
    if (rack.printed) return 'printed';
    if (rack.submittedLineCount > 0) return 'submitted';
    return 'empty';
  }

  rackStateLabel(rack: Rack): string {
    return ({ printed: 'Sudah Print', submitted: 'Sudah Submit', empty: 'Belum Scan' })[this.rackState(rack)];
  }

  private fetchPage(initial: boolean) {
    initial ? this.loading.set(true) : this.refreshing.set(true);
    this.errorMessage.set('');
    return forkJoin({
      schedules: this.api.getSchedules().pipe(catchError(() => of([]))),
      rackResponse: this.api.getRacks(this.scheduleId)
    }).pipe(
      tap(({ schedules, rackResponse }) => {
        this.schedule.set(schedules.find((schedule) => schedule.id === this.scheduleId) ?? null);
        this.scheduleLocation.set(rackResponse.schedule);
        this.racks.set(rackResponse.racks);
        const selected = this.selectedRack();
        if (selected) {
          const current = rackResponse.racks.find((rack) => rack.id === selected.id);
          if (current) {
            this.selectedRack.set(current);
            this.loadRackScans(current.id, false);
          } else {
            this.closeDetail();
          }
        }
        this.loading.set(false);
        this.refreshing.set(false);
        this.lastUpdated.set(new Date());
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Data rack gagal dimuat.'));
        this.loading.set(false);
        this.refreshing.set(false);
        return EMPTY;
      })
    );
  }

  private loadRackScans(rackId: string, showLoading = true): void {
    if (showLoading) this.scansLoading.set(true);
    this.scanErrorMessage.set('');
    this.api.getRackScans(this.scheduleId, rackId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ scans }) => {
          if (this.selectedRack()?.id === rackId) this.scans.set(scans);
          this.scansLoading.set(false);
        },
        error: (error: unknown) => {
          this.scanErrorMessage.set(apiErrorMessage(error, 'Detail item rack gagal dimuat.'));
          this.scansLoading.set(false);
        }
      });
  }
}
