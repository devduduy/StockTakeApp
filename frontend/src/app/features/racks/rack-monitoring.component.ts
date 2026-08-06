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
    if (rack.submittedLineCount === 0 || this.scansLoading() || this.printing()) return;
    this.printErrorMessage.set('');
    if (rack.printed) {
      this.printRackPaper(rack);
      return;
    }
    this.printConfirmRack.set(rack);
  }

  closePrintConfirm(): void {
    if (!this.printing()) this.printConfirmRack.set(null);
  }

  confirmPrint(): void {
    const rack = this.printConfirmRack();
    if (!rack || this.printing()) return;
    this.printRackPaper(rack);
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

  private printRackPaper(rack: Rack): void {
    const scans = this.scans();
    if (scans.length === 0) {
      this.printErrorMessage.set('Data item belum siap untuk dicetak. Tunggu detail rack selesai dimuat.');
      return;
    }

    const popup = window.open('', '_blank', 'width=980,height=720');
    if (!popup) {
      this.printErrorMessage.set('Popup browser diblokir. Izinkan popup untuk mencetak rack.');
      return;
    }

    this.printing.set(true);
    this.printErrorMessage.set('');
    this.printMessage.set('');
    this.api.printRack(this.scheduleId, rack.id)
      .pipe(
        switchMap((result) => {
          this.writePrintDocument(
            popup,
            this.buildRackPrintSheetHtml(rack, scans, result.printNo, result.printTime)
          );
          this.printMessage.set(
            rack.printed
              ? `Rack ${rack.rackCode} dicetak ulang. Print time berhasil diperbarui.`
              : `Rack ${rack.rackCode} berhasil diprint dengan nomor ${result.printNo}.`
          );
          this.printConfirmRack.set(null);
          return this.fetchPage(false);
        }),
        tap(() => {
          this.loadRackScans(rack.id, false);
          this.printing.set(false);
        }),
        catchError((error: unknown) => {
          popup.close();
          this.printErrorMessage.set(apiErrorMessage(error, 'Rack gagal diprint.'));
          this.printing.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
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

  private writePrintDocument(popup: Window, html: string): void {
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  private buildRackPrintSheetHtml(rack: Rack, scans: RackScan[], printNo: string, printTime: string): string {
    const schedule = this.schedule();
    const location = schedule?.location?.name || `Lokasi ${this.scheduleLocation()?.locCode || '-'}`;
    const totalQuantity = scans.reduce((sum, scan) => sum + scan.scanQty, 0);
    const rows = scans
      .slice()
      .sort((left, right) => left.rackSeq - right.rackSeq)
      .map((scan) => `
        <tr>
          <td class="number">${scan.rackSeq}</td>
          <td>${this.escapeHtml(scan.plu)}</td>
          <td>${this.escapeHtml(scan.barcode)}</td>
          <td>${this.escapeHtml(scan.pluDescription)}</td>
          <td class="number">${scan.scanQty.toLocaleString('id-ID')}</td>
          <td>${this.formatDateTime(scan.dateCreated)}</td>
        </tr>
      `)
      .join('');

    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Print Rack ${this.escapeHtml(rack.rackCode)}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; color: #000; font-family: Arial, sans-serif; }
            main { padding: 24px; }
            header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; border-bottom: 2px solid #000; padding-bottom: 14px; }
            h1 { margin: 0; color: #000; font-size: 22px; }
            .subtitle { margin-top: 6px; color: #000; font-size: 12px; }
            .print-no { text-align: right; }
            .print-no span, .print-no small { color: #000; }
            .print-no strong { display: block; color: #000; font-size: 15px; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .meta div { border: 1px solid #000; border-radius: 8px; padding: 10px; }
            .meta span { display: block; color: #000; font-size: 10px; text-transform: uppercase; }
            .meta strong { display: block; margin-top: 4px; color: #000; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { background: #fff; color: #000; font-weight: 700; text-align: left; }
            th, td { border: 1px solid #000; padding: 7px; vertical-align: top; }
            td.number, th.number { text-align: right; }
            tfoot td { font-weight: 700; }
            @page { size: A4; margin: 12mm; }
          </style>
        </head>
        <body>
          <main>
            <header>
              <div>
                <h1>Hero Stock Take - Print Rack</h1>
                <div class="subtitle">${this.escapeHtml(schedule?.scheduleNo || this.scheduleLocation()?.scheduleNo || '-')} &middot; ${this.escapeHtml(schedule?.scheduleDesc || '-')}</div>
              </div>
              <div class="print-no">
                <span>Print No</span>
                <strong>${this.escapeHtml(printNo)}</strong>
                <small>${this.formatDateTime(printTime)}</small>
              </div>
            </header>
            <section class="meta">
              <div><span>Lokasi</span><strong>${this.escapeHtml(location)}</strong></div>
              <div><span>Rack</span><strong>${this.escapeHtml(rack.rackCode)} - ${this.escapeHtml(rack.rackName)}</strong></div>
              <div><span>Total item</span><strong>${scans.length.toLocaleString('id-ID')}</strong></div>
              <div><span>Total qty</span><strong>${totalQuantity.toLocaleString('id-ID')}</strong></div>
            </section>
            <table>
              <thead><tr><th class="number">Seq</th><th>PLU</th><th>Barcode</th><th>Deskripsi</th><th class="number">Qty</th><th>Waktu Scan</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr><td colspan="4">Total</td><td class="number">${totalQuantity.toLocaleString('id-ID')}</td><td></td></tr></tfoot>
            </table>
          </main>
        </body>
      </html>`;
  }

  private formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
