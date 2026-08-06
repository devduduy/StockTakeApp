import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, EMPTY, forkJoin, interval, of, switchMap, take, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, Rack, RackScan, ScheduleLocation, UserOption } from '../../core/models/api.models';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-rack-monitoring',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './rack-monitoring.component.html',
  styleUrl: './rack-monitoring.component.scss'
})
export class RackMonitoringComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly auth = inject(AuthService);
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
  readonly correctionSaving = signal(false);
  readonly confirming = signal(false);
  readonly rejecting = signal(false);
  readonly printConfirmRack = signal<Rack | null>(null);
  readonly errorMessage = signal('');
  readonly scanErrorMessage = signal('');
  readonly printMessage = signal('');
  readonly printErrorMessage = signal('');
  readonly correctionMessage = signal('');
  readonly correctionErrorMessage = signal('');
  readonly search = signal('');
  readonly itemSearch = signal('');
  readonly statusFilter = signal<'ALL' | 'EMPTY' | 'SUBMITTED' | 'PRINTED' | 'CONFIRMED' | 'REJECTED'>('ALL');
  readonly lastUpdated = signal<Date | null>(null);
  readonly finalQtyDrafts = signal<Record<string, string>>({});
  readonly dirtyFinalQtyDrafts = signal<Set<string>>(new Set());
  readonly recheckers = signal<UserOption[]>([]);
  readonly selectedRecheckUser = signal('');
  readonly actionConfirm = signal<'CONFIRM' | 'REJECT' | null>(null);

  readonly filteredRacks = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.racks().filter((rack) => {
      const matchesKeyword = !keyword || [rack.rackCode, rack.rackName].some((value) => value.toLowerCase().includes(keyword));
      const matchesStatus = status === 'ALL'
        || (status === 'SUBMITTED' && !rack.printed && rack.submittedLineCount > 0)
        || (status === 'PRINTED' && rack.rackStatus === 'PRINTED')
        || (status === 'CONFIRMED' && rack.rackStatus === 'CONFIRMED')
        || (status === 'REJECTED' && rack.rackStatus === 'REJECTED')
        || (status === 'EMPTY' && rack.rackStatus === 'EMPTY');
      return matchesKeyword && matchesStatus;
    });
  });
  readonly submittedCount = computed(() => this.racks().filter((rack) => rack.submittedLineCount > 0).length);
  readonly printedCount = computed(() => this.racks().filter((rack) => rack.printed).length);
  readonly totalLines = computed(() => this.racks().reduce((sum, rack) => sum + rack.submittedLineCount, 0));
  readonly totalQuantity = computed(() => this.racks().reduce((sum, rack) => sum + rack.submittedQuantity, 0));
  readonly selectedFinalQuantity = computed(() =>
    this.scans().reduce((sum, scan) => {
      const draft = this.finalQtyDraft(scan.id).trim();
      return sum + (draft === '' ? scan.finalQty : Number(draft));
    }, 0)
  );
  readonly correctionCount = computed(() => this.racks().filter((rack) => rack.discrepancyQuantity !== 0).length);
  readonly filteredScans = computed(() => {
    const keyword = this.itemSearch().trim().toLowerCase();
    if (!keyword) return this.scans();
    return this.scans().filter((scan) => (
      scan.plu.toLowerCase().includes(keyword)
      || scan.pluDescription.toLowerCase().includes(keyword)
      || scan.barcode.toLowerCase().includes(keyword)
    ));
  });
  readonly finalQtySummary = computed(() => {
    const scans = this.scans();
    const discrepancyItems = scans
      .map((scan) => this.discrepancyPreview(scan))
      .filter((discrepancyQty) => discrepancyQty !== 0);
    return {
      scanQty: scans.reduce((sum, scan) => sum + scan.scanQty, 0),
      finalQty: scans.reduce((sum, scan) => {
        const finalQtyDraft = this.finalQtyDraft(scan.id).trim();
        return sum + (finalQtyDraft === '' ? scan.finalQty : Number(finalQtyDraft));
      }, 0),
      discrepancyItemCount: discrepancyItems.length,
      discrepancyQty: discrepancyItems.reduce((sum, discrepancyQty) => sum + discrepancyQty, 0)
    };
  });

  constructor() {
    interval(10_000)
      .pipe(
        switchMap(() => this.fetchPage(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
    this.fetchPage(true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    this.api.getRecheckers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (users) => this.recheckers.set(users),
      error: () => this.recheckers.set([])
    });
  }

  refresh(): void {
    if (!this.refreshing()) this.fetchPage(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  selectRack(rack: Rack): void {
    this.selectedRack.set(rack);
    this.selectedRecheckUser.set('');
    this.itemSearch.set('');
    this.dirtyFinalQtyDrafts.set(new Set());
    this.finalQtyDrafts.set({});
    this.loadRackScans(rack.id);
  }

  closeDetail(): void {
    this.selectedRack.set(null);
    this.scans.set([]);
    this.scanErrorMessage.set('');
    this.printErrorMessage.set('');
    this.correctionErrorMessage.set('');
    this.correctionMessage.set('');
    this.actionConfirm.set(null);
    this.itemSearch.set('');
    this.dirtyFinalQtyDrafts.set(new Set());
    this.finalQtyDrafts.set({});
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

  setStatusFilter(status: 'ALL' | 'EMPTY' | 'SUBMITTED' | 'PRINTED' | 'CONFIRMED' | 'REJECTED'): void {
    this.statusFilter.set(status);
  }

  rackState(rack: Rack): 'confirmed' | 'rejected' | 'printed' | 'submitted' | 'empty' {
    if (rack.rackStatus === 'CONFIRMED') return 'confirmed';
    if (rack.rackStatus === 'REJECTED') return 'rejected';
    if (rack.rackStatus === 'PRINTED') return 'printed';
    if (rack.rackStatus === 'SUBMITTED') return 'submitted';
    return 'empty';
  }

  rackStateLabel(rack: Rack): string {
    return ({
      confirmed: 'Confirm',
      rejected: 'Reject',
      printed: 'Sudah Print',
      submitted: 'Sudah Submit',
      empty: 'Belum Scan'
    })[this.rackState(rack)];
  }

  finalQtyDraft(scanId: string): string {
    return this.finalQtyDrafts()[scanId] ?? '';
  }

  setFinalQtyDraft(scanId: string, value: string): void {
    const sanitized = value.replace(/[^\d]/g, '');
    this.finalQtyDrafts.update((drafts) => ({ ...drafts, [scanId]: sanitized }));
    this.dirtyFinalQtyDrafts.update((drafts) => new Set(drafts).add(scanId));
  }

  discrepancyPreview(scan: RackScan): number {
    const finalQtyDraft = this.finalQtyDraft(scan.id).trim();
    return (finalQtyDraft === '' ? scan.finalQty : Number(finalQtyDraft)) - scan.scanQty;
  }

  hasUnsavedDiscrepancy(): boolean {
    const dirtyDrafts = this.dirtyFinalQtyDrafts();
    return this.scans().some((scan) => (
      dirtyDrafts.has(scan.id)
      && this.discrepancyPreview(scan) !== scan.discrepancyQty
      && this.discrepancyPreview(scan) !== 0
    ));
  }

  saveCorrections(): void {
    const rack = this.selectedRack();
    const recheckUser = this.selectedRecheckUser().trim();
    if (!rack || this.correctionSaving() || !rack.printed || rack.rackStatus === 'CONFIRMED') return;
    if (!recheckUser) {
      this.correctionErrorMessage.set('Pilih user rechecker terlebih dahulu.');
      return;
    }
    const payload = this.finalQtyPayload(recheckUser);
    this.correctionSaving.set(true);
    this.correctionErrorMessage.set('');
    this.correctionMessage.set('');
    this.api.updateRackFinalQty(this.scheduleId, rack.id, payload)
      .pipe(
        switchMap(({ scans }) => {
          this.scans.set(scans);
          this.dirtyFinalQtyDrafts.set(new Set());
          this.syncFinalQtyDrafts(scans, true);
          this.correctionMessage.set('Final qty berhasil disimpan.');
          return this.fetchPage(false);
        }),
        tap(() => this.correctionSaving.set(false)),
        catchError((error: unknown) => {
          this.correctionErrorMessage.set(apiErrorMessage(error, 'Final qty gagal disimpan.'));
          this.correctionSaving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  confirmRack(): void {
    const rack = this.selectedRack();
    const recheckUser = this.selectedRecheckUser().trim();
    if (!rack || this.confirming() || !rack.printed || rack.rackStatus === 'CONFIRMED') return;
    if (!recheckUser) {
      this.correctionErrorMessage.set('Pilih user rechecker sebelum confirm rack.');
      return;
    }
    this.confirming.set(true);
    this.correctionErrorMessage.set('');
    this.correctionMessage.set('');
    this.api.confirmRack(this.scheduleId, rack.id, this.finalQtyPayload(recheckUser))
      .pipe(
        switchMap(({ scans }) => {
          this.scans.set(scans);
          this.dirtyFinalQtyDrafts.set(new Set());
          this.syncFinalQtyDrafts(scans, true);
          this.correctionMessage.set('Rack berhasil di-confirm.');
          this.actionConfirm.set(null);
          return this.fetchPage(false);
        }),
        tap(() => this.confirming.set(false)),
        catchError((error: unknown) => {
          this.correctionErrorMessage.set(apiErrorMessage(error, 'Rack gagal di-confirm.'));
          this.confirming.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  rejectRack(): void {
    const rack = this.selectedRack();
    if (!rack || this.rejecting() || rack.rackStatus === 'CONFIRMED') return;
    this.rejecting.set(true);
    this.correctionErrorMessage.set('');
    this.correctionMessage.set('');
    this.api.rejectRack(this.scheduleId, rack.id)
      .pipe(
        switchMap(() => {
          this.correctionMessage.set('Rack berhasil direject. Progress aktif dikembalikan untuk scan ulang.');
          this.scans.set([]);
          this.dirtyFinalQtyDrafts.set(new Set());
          this.syncFinalQtyDrafts([], true);
          this.actionConfirm.set(null);
          return this.fetchPage(false);
        }),
        tap(() => this.rejecting.set(false)),
        catchError((error: unknown) => {
          this.correctionErrorMessage.set(apiErrorMessage(error, 'Rack gagal direject.'));
          this.rejecting.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  openActionConfirm(action: 'CONFIRM' | 'REJECT'): void {
    const rack = this.selectedRack();
    if (!rack) return;
    if (action === 'CONFIRM' && (!rack.printed || rack.rackStatus === 'CONFIRMED' || this.confirming())) return;
    if (action === 'REJECT' && (rack.rackStatus === 'CONFIRMED' || this.rejecting())) return;
    if (action === 'CONFIRM' && !this.selectedRecheckUser().trim()) {
      this.correctionErrorMessage.set('Pilih user rechecker sebelum confirm rack.');
      return;
    }
    if (action === 'CONFIRM' && this.hasUnsavedDiscrepancy()) {
      this.correctionErrorMessage.set('Ada selisih Final Qty yang belum disimpan. Klik Simpan Koreksi terlebih dahulu sebelum confirm rack.');
      return;
    }
    this.correctionErrorMessage.set('');
    this.actionConfirm.set(action);
  }

  closeActionConfirm(): void {
    if (!this.confirming() && !this.rejecting()) {
      this.actionConfirm.set(null);
    }
  }

  executeConfirmedAction(): void {
    const action = this.actionConfirm();
    if (action === 'CONFIRM') {
      this.confirmRack();
      return;
    }
    if (action === 'REJECT') {
      this.rejectRack();
    }
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
          if (this.selectedRack()?.id === rackId) {
            this.scans.set(scans);
            this.syncFinalQtyDrafts(scans);
          }
          this.scansLoading.set(false);
        },
        error: (error: unknown) => {
          this.scanErrorMessage.set(apiErrorMessage(error, 'Detail item rack gagal dimuat.'));
          this.scansLoading.set(false);
        }
      });
  }

  private finalQtyPayload(recheckUser: string) {
    return {
      recheckUser,
      lines: this.scans().map((scan) => {
        const finalQtyDraft = this.finalQtyDraft(scan.id).trim();
        return {
          scanId: scan.id,
          finalQty: finalQtyDraft === '' ? scan.finalQty : Number(finalQtyDraft)
        };
      })
    };
  }

  private syncFinalQtyDrafts(scans: RackScan[], force = false): void {
    const dirtyIds = this.dirtyFinalQtyDrafts();
    this.finalQtyDrafts.update((current) => {
      const next: Record<string, string> = {};
      for (const scan of scans) {
        next[scan.id] = !force && dirtyIds.has(scan.id)
          ? current[scan.id] ?? String(scan.finalQty)
          : String(scan.finalQty);
      }
      return next;
    });
    const selectedUser = scans.find((scan) => scan.recheckUser)?.recheckUser ?? '';
    if (selectedUser) {
      this.selectedRecheckUser.set(selectedUser);
    }
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
    const printedBy = this.auth.user()?.fullName || this.auth.user()?.username || '-';
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
          <td class="qty-checker"></td>
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
            main { padding: 16px 18px; }
            header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 2px solid #000; padding-bottom: 8px; }
            h1 { margin: 0; color: #000; font-size: 18px; }
            .subtitle { margin-top: 4px; color: #000; font-size: 10px; }
            .print-no { text-align: right; }
            .print-no span, .print-no small { color: #000; }
            .print-no strong { display: block; color: #000; font-size: 12px; }
            .meta { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; row-gap: 2px; margin: 10px 0 12px; font-size: 10px; }
            .meta div { display: grid; grid-template-columns: 74px 1fr; gap: 6px; min-width: 0; }
            .meta span { color: #000; font-weight: 700; }
            .meta strong { overflow: hidden; color: #000; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th { background: #fff; color: #000; font-weight: 700; text-align: left; }
            th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; }
            td.number, th.number { text-align: right; }
            tfoot td { font-weight: 700; }
            th.qty-checker, td.qty-checker { width: 76px; }
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
              <div><span>Printed By</span><strong>${this.escapeHtml(printedBy)}</strong></div>
            </section>
            <table>
              <thead><tr><th class="number">Seq</th><th>PLU</th><th>Barcode</th><th>Deskripsi</th><th class="number">Qty</th><th>Waktu Scan</th><th class="qty-checker">Qty Checker</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr><td colspan="4">Total</td><td class="number">${totalQuantity.toLocaleString('id-ID')}</td><td></td><td></td></tr></tfoot>
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
