import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, EMPTY, forkJoin, interval, of, switchMap, take, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, Rack, RackMaster, RackScan, ScheduleLocation, UserOption } from '../../core/models/api.models';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-rack-monitoring',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './rack-monitoring.component.html',
  styleUrl: './rack-monitoring.component.scss'
})
export class RackMonitoringComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  readonly scheduleId = this.route.snapshot.paramMap.get('scheduleId') ?? '';

  readonly schedule = signal<ActiveSchedule | null>(null);
  readonly scheduleLocation = signal<ScheduleLocation | null>(null);
  readonly racks = signal<Rack[]>([]);
  readonly rackMasters = signal<RackMaster[]>([]);
  readonly scans = signal<RackScan[]>([]);
  readonly selectedRack = signal<Rack | null>(null);
  readonly pendingPrintScans = signal<RackScan[]>([]);
  readonly rowConfirmRack = signal<Rack | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly addRackOpen = signal(false);
  readonly addRackLoading = signal(false);
  readonly addRackSaving = signal(false);
  readonly rackCreateOpen = signal(false);
  readonly scansLoading = signal(false);
  readonly printing = signal(false);
  readonly bulkConfirming = signal(false);
  readonly closingSchedule = signal(false);
  readonly correctionSaving = signal(false);
  readonly confirming = signal(false);
  readonly rejecting = signal(false);
  readonly printConfirmRack = signal<Rack | null>(null);
  readonly errorMessage = signal('');
  readonly scanErrorMessage = signal('');
  readonly printMessage = signal('');
  readonly printErrorMessage = signal('');
  readonly rackScopeMessage = signal('');
  readonly rackScopeErrorMessage = signal('');
  readonly rackCreateErrorMessage = signal('');
  readonly correctionMessage = signal('');
  readonly correctionErrorMessage = signal('');
  readonly search = signal('');
  readonly addRackSearch = signal('');
  readonly rackCreateLetterSearch = signal('');
  readonly rackCreateLetterDropdownOpen = signal(false);
  readonly rackCreateSequence = signal('001');
  readonly itemSearch = signal('');
  readonly statusFilter = signal<'ALL' | 'EMPTY' | 'SUBMITTED' | 'PRINTED' | 'CONFIRMED' | 'REJECTED'>('ALL');
  readonly lastUpdated = signal<Date | null>(null);
  readonly finalQtyDrafts = signal<Record<string, string>>({});
  readonly dirtyFinalQtyDrafts = signal<Set<string>>(new Set());
  readonly recheckers = signal<UserOption[]>([]);
  readonly selectedRecheckUser = signal('');
  readonly actionConfirm = signal<'CONFIRM' | 'REJECT' | null>(null);
  readonly selectedBulkRackIds = signal<Set<string>>(new Set());
  readonly printQtyVisible = signal(true);
  readonly closeScheduleConfirm = signal(false);
  readonly rackLetterCodes = this.buildRackLetterCodes();
  readonly rackCreateForm = this.fb.nonNullable.group({
    rackCode: ['', [Validators.required, Validators.pattern(/^RCK-([A-Z])\1-\d{3}$/)]],
    rackName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', [Validators.required]]
  });

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
  readonly correctionCount = computed(() => this.racks().filter((rack) => rack.discrepancyQuantity !== 0 || rack.rackStatus === 'CONFIRMED').length);
  readonly confirmedCount = computed(() => this.racks().filter((rack) => rack.rackStatus === 'CONFIRMED').length);
  readonly emptyCount = computed(() => this.racks().filter((rack) => rack.rackStatus === 'EMPTY').length);
  readonly selectedBulkRacks = computed(() => {
    const selected = this.selectedBulkRackIds();
    return this.racks().filter((rack) => selected.has(rack.id) && this.canBulkConfirmRack(rack));
  });
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
  readonly availableRackMasters = computed(() => {
    const usedRackIds = new Set(this.racks().map((rack) => rack.id));
    const keyword = this.addRackSearch().trim().toLowerCase();
    return this.rackMasters()
      .filter((rack) => rack.status === 'ACTIVE' && !usedRackIds.has(rack.id))
      .filter((rack) => !keyword || [
        rack.rackCode,
        rack.rackName,
        rack.locCode
      ].some((value) => value.toLowerCase().includes(keyword)));
  });
  readonly filteredRackCreateLetterCodes = computed(() => {
    const keyword = this.rackCreateLetterSearch().trim().toUpperCase();
    return this.rackLetterCodes.filter((letterCode) => !keyword || letterCode.includes(keyword));
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
      this.printRackPaper(rack, undefined, this.scans());
      return;
    }
    this.pendingPrintScans.set(this.scans());
    this.printConfirmRack.set(rack);
  }

  openPrintFromList(rack: Rack, event: Event): void {
    event.stopPropagation();
    if (rack.submittedLineCount === 0 || this.printing()) return;
    const preopenedPopup = rack.printed ? window.open('', '_blank', 'width=980,height=720') : null;
    if (rack.printed && !preopenedPopup) {
      this.printErrorMessage.set('Popup browser diblokir. Izinkan popup untuk mencetak rack.');
      return;
    }
    this.scansLoading.set(true);
    this.api.getRackScans(this.scheduleId, rack.id)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ scans }) => {
          this.pendingPrintScans.set(scans);
          this.scansLoading.set(false);
          if (rack.printed) {
            this.printRackPaper(rack, preopenedPopup ?? undefined, scans);
          } else {
            this.printErrorMessage.set('');
            this.printConfirmRack.set(rack);
          }
        },
        error: (error: unknown) => {
          preopenedPopup?.close();
          this.printErrorMessage.set(apiErrorMessage(error, 'Data rack gagal dimuat untuk print.'));
          this.scansLoading.set(false);
        }
      });
  }

  closePrintConfirm(): void {
    if (!this.printing()) this.printConfirmRack.set(null);
  }

  confirmPrint(): void {
    const rack = this.printConfirmRack();
    if (!rack || this.printing()) return;
    this.printRackPaper(rack, undefined, this.pendingPrintScans());
  }

  setStatusFilter(status: 'ALL' | 'EMPTY' | 'SUBMITTED' | 'PRINTED' | 'CONFIRMED' | 'REJECTED'): void {
    this.statusFilter.set(status);
  }

  canAddRackToSchedule(): boolean {
    const status = this.scheduleLocation()?.status ?? this.schedule()?.status ?? '';
    return this.auth.user()?.role.code !== 'SCANNER'
      && Boolean(this.scheduleLocation()?.locCode)
      && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(status);
  }

  openAddRack(): void {
    if (!this.canAddRackToSchedule()) return;
    this.addRackSearch.set('');
    this.rackScopeErrorMessage.set('');
    this.rackCreateErrorMessage.set('');
    this.rackCreateOpen.set(false);
    this.rackCreateForm.reset({
      rackCode: '',
      rackName: '',
      status: 'ACTIVE'
    });
    this.rackCreateLetterSearch.set('');
    this.rackCreateLetterDropdownOpen.set(false);
    this.rackCreateSequence.set('001');
    this.addRackOpen.set(true);
    this.loadRackMastersForSchedule();
  }

  closeAddRack(): void {
    if (!this.addRackSaving()) this.addRackOpen.set(false);
  }

  toggleRackCreate(): void {
    this.rackScopeErrorMessage.set('');
    this.rackCreateErrorMessage.set('');
    this.rackCreateOpen.update((open) => !open);
  }

  assignRackToSchedule(rack: RackMaster): void {
    if (!this.canAddRackToSchedule() || this.addRackSaving()) return;
    this.addRackSaving.set(true);
    this.rackScopeErrorMessage.set('');
    this.rackScopeMessage.set('');
    this.api.addRackToSchedule(this.scheduleId, rack.id)
      .pipe(
        switchMap(() => this.fetchPage(false)),
        tap(() => {
          this.rackScopeMessage.set(`Rack ${rack.rackCode} berhasil ditambahkan ke schedule.`);
          this.addRackSaving.set(false);
          this.loadRackMastersForSchedule();
        }),
        catchError((error: unknown) => {
          this.rackScopeErrorMessage.set(apiErrorMessage(error, 'Rack gagal ditambahkan ke schedule.'));
          this.addRackSaving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  createRackAndAssign(): void {
    const locCode = this.scheduleLocation()?.locCode;
    if (!locCode || !this.canAddRackToSchedule() || this.addRackSaving()) return;
    this.normalizeRackCreateCode();
    if (this.rackCreateForm.invalid) {
      this.rackCreateForm.markAllAsTouched();
      return;
    }
    const raw = this.rackCreateForm.getRawValue();
    this.addRackSaving.set(true);
    this.rackCreateErrorMessage.set('');
    this.rackScopeMessage.set('');
    this.api.createRack({
      locCode,
      rackCode: raw.rackCode.trim(),
      rackName: raw.rackName.trim(),
      status: raw.status
    })
      .pipe(
        switchMap((rack) =>
          this.api.addRackToSchedule(this.scheduleId, rack.id).pipe(
            switchMap(() => this.fetchPage(false)),
            tap(() => {
              this.rackScopeMessage.set(`Rack ${rack.rackCode} berhasil dibuat dan ditambahkan ke schedule.`);
            })
          )
        ),
        tap(() => {
          this.addRackSaving.set(false);
          this.rackCreateOpen.set(false);
          this.rackCreateForm.reset({ rackCode: '', rackName: '', status: 'ACTIVE' });
          this.loadRackMastersForSchedule();
        }),
        catchError((error: unknown) => {
          this.rackCreateErrorMessage.set(apiErrorMessage(error, 'Rack baru gagal dibuat.'));
          this.addRackSaving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  normalizeRackCreateCode(): void {
    this.rackCreateSequence.set(this.normalizeRackSequence(this.rackCreateSequence()));
    this.composeRackCreateCode();
  }

  onRackCreateLetterFocus(): void {
    this.rackCreateLetterDropdownOpen.set(true);
  }

  onRackCreateLetterInput(value: string): void {
    const normalized = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    this.rackCreateLetterSearch.set(normalized);
    this.rackCreateLetterDropdownOpen.set(true);
    this.composeRackCreateCode();
  }

  onRackCreateLetterBlur(): void {
    window.setTimeout(() => {
      const value = this.rackCreateLetterSearch().trim().toUpperCase();
      if (this.rackLetterCodes.includes(value)) {
        this.selectRackCreateLetterCode(value);
      } else if (!value) {
        this.rackCreateForm.controls.rackCode.setValue('');
      } else {
        this.rackCreateLetterSearch.set('');
        this.rackCreateForm.controls.rackCode.setValue('');
        this.rackCreateForm.controls.rackCode.markAsTouched();
      }
      this.rackCreateLetterDropdownOpen.set(false);
    }, 120);
  }

  selectRackCreateLetterCode(letterCode: string): void {
    this.rackCreateLetterSearch.set(letterCode);
    this.rackCreateLetterDropdownOpen.set(false);
    this.composeRackCreateCode(true);
  }

  onRackCreateSequenceInput(value: string): void {
    this.rackCreateSequence.set(value.replace(/\D/g, '').slice(0, 3));
    this.composeRackCreateCode();
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

  rackPercent(count: number): number {
    const total = this.racks().length;
    return total <= 0 ? 0 : Math.round((count / total) * 100);
  }

  canBulkConfirmRack(rack: Rack): boolean {
    return rack.printed && rack.rackStatus !== 'CONFIRMED' && rack.submittedLineCount > 0;
  }

  openRowConfirm(rack: Rack, event: Event): void {
    event.stopPropagation();
    if (!this.canBulkConfirmRack(rack) || this.confirming()) return;
    this.printErrorMessage.set('');
    this.rowConfirmRack.set(rack);
  }

  closeRowConfirm(): void {
    if (!this.confirming()) this.rowConfirmRack.set(null);
  }

  confirmRackFromList(): void {
    const rack = this.rowConfirmRack();
    const recheckUser = this.auth.user()?.username || '';
    if (!rack || !this.canBulkConfirmRack(rack) || this.confirming()) return;
    if (!recheckUser) {
      this.printErrorMessage.set('Session user tidak tersedia untuk confirm rack.');
      return;
    }
    this.confirming.set(true);
    this.printErrorMessage.set('');
    this.api.getRackScans(this.scheduleId, rack.id)
      .pipe(
        switchMap(({ scans }) => this.api.confirmRack(this.scheduleId, rack.id, {
          recheckUser,
          lines: scans.map((scan) => ({ scanId: scan.id, finalQty: scan.finalQty }))
        })),
        switchMap(() => this.fetchPage(false)),
        tap(() => {
          this.printMessage.set(`Rack ${rack.rackCode} berhasil di-confirm.`);
          this.rowConfirmRack.set(null);
          this.confirming.set(false);
        }),
        catchError((error: unknown) => {
          this.printErrorMessage.set(apiErrorMessage(error, 'Rack gagal di-confirm.'));
          this.confirming.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  bulkRackChecked(rack: Rack): boolean {
    return this.selectedBulkRackIds().has(rack.id);
  }

  toggleBulkRack(rack: Rack, checked: boolean, event: Event): void {
    event.stopPropagation();
    if (!this.canBulkConfirmRack(rack)) return;
    this.selectedBulkRackIds.update((current) => {
      const next = new Set(current);
      checked ? next.add(rack.id) : next.delete(rack.id);
      return next;
    });
  }

  toggleAllBulkRack(checked: boolean): void {
    this.selectedBulkRackIds.set(
      checked
        ? new Set(this.filteredRacks().filter((rack) => this.canBulkConfirmRack(rack)).map((rack) => rack.id))
        : new Set()
    );
  }

  bulkConfirmSelected(): void {
    const racks = this.selectedBulkRacks();
    const recheckUser = this.auth.user()?.username || '';
    if (racks.length === 0 || this.bulkConfirming()) return;
    if (!recheckUser) {
      this.printErrorMessage.set('Session user tidak tersedia untuk bulk confirm.');
      return;
    }
    this.bulkConfirming.set(true);
    this.printErrorMessage.set('');
    forkJoin(
      racks.map((rack) =>
        this.api.getRackScans(this.scheduleId, rack.id).pipe(
          switchMap(({ scans }) => this.api.confirmRack(this.scheduleId, rack.id, {
            recheckUser,
            lines: scans.map((scan) => ({ scanId: scan.id, finalQty: scan.finalQty }))
          }))
        )
      )
    )
      .pipe(
        switchMap(() => this.fetchPage(false)),
        tap(() => {
          this.printMessage.set(`${racks.length} rack berhasil di-confirm.`);
          this.selectedBulkRackIds.set(new Set());
          this.bulkConfirming.set(false);
        }),
        catchError((error: unknown) => {
          this.printErrorMessage.set(apiErrorMessage(error, 'Bulk confirm gagal diproses.'));
          this.bulkConfirming.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  canCloseSchedule(): boolean {
    const status = this.scheduleLocation()?.status ?? this.schedule()?.status ?? '';
    return this.racks().length > 0
      && this.racks().every((rack) => rack.rackStatus === 'CONFIRMED')
      && !['CLOSED', 'COMPLETED', 'CANCELLED'].includes(status);
  }

  openCloseScheduleConfirm(): void {
    if (this.canCloseSchedule()) this.closeScheduleConfirm.set(true);
  }

  closeCloseScheduleConfirm(): void {
    if (!this.closingSchedule()) this.closeScheduleConfirm.set(false);
  }

  closeSchedule(): void {
    if (!this.canCloseSchedule() || this.closingSchedule()) return;
    this.closingSchedule.set(true);
    this.printErrorMessage.set('');
    this.api.closeSchedule(this.scheduleId)
      .pipe(
        switchMap(() => this.fetchPage(false)),
        tap(() => {
          this.printMessage.set('Schedule berhasil di-close.');
          this.closeScheduleConfirm.set(false);
          this.closingSchedule.set(false);
        }),
        catchError((error: unknown) => {
          this.printErrorMessage.set(apiErrorMessage(error, 'Schedule gagal di-close.'));
          this.closingSchedule.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
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

  private printRackPaper(rack: Rack, preopenedPopup?: Window, scanLines?: RackScan[]): void {
    const scans = scanLines ?? this.scans();
    if (scans.length === 0) {
      preopenedPopup?.close();
      this.printErrorMessage.set('Data item belum siap untuk dicetak. Tunggu detail rack selesai dimuat.');
      return;
    }

    const popup = preopenedPopup ?? window.open('', '_blank', 'width=980,height=720');
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
          this.pendingPrintScans.set([]);
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
        this.selectedBulkRackIds.update((current) => new Set(
          [...current].filter((rackId) => rackResponse.racks.some((rack) => rack.id === rackId && this.canBulkConfirmRack(rack)))
        ));
        const selected = this.selectedRack();
        if (selected) {
          const current = rackResponse.racks.find((rack) => rack.id === selected.id);
          if (current) {
            this.selectedRack.set(current);
            if (!this.printing()) this.loadRackScans(current.id, false);
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

  private loadRackMastersForSchedule(): void {
    const locCode = this.scheduleLocation()?.locCode;
    if (!locCode) {
      this.rackMasters.set([]);
      return;
    }
    this.addRackLoading.set(true);
    this.api.getRackMasters(locCode)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (racks) => {
          this.rackMasters.set(racks);
          this.addRackLoading.set(false);
        },
        error: (error: unknown) => {
          this.rackScopeErrorMessage.set(apiErrorMessage(error, 'Master rack lokasi gagal dimuat.'));
          this.rackMasters.set([]);
          this.addRackLoading.set(false);
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
          ${this.printQtyVisible() ? `<td class="number">${scan.scanQty.toLocaleString('id-ID')}</td>` : ''}
          <td class="qty-checker"></td>
          <td class="notes"></td>
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
            .rack-title { margin: 8px 0 0; color: #000; font-size: 26px; font-weight: 800; }
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
            th.qty-checker, td.qty-checker { width: 78px; }
            th.notes, td.notes { width: 108px; }
            @page { size: A4; margin: 12mm; }
          </style>
        </head>
        <body>
          <main>
            <header>
              <div>
                <h1>Hero Stock Take - Print Rack</h1>
                <div class="rack-title">${this.escapeHtml(rack.rackCode)}</div>
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
              <thead><tr><th class="number">Seq</th><th>PLU</th><th>Barcode</th><th>Deskripsi</th>${this.printQtyVisible() ? '<th class="number">Qty</th>' : ''}<th class="qty-checker">Qty Checker</th><th class="notes">Notes</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr><td colspan="4">Total</td>${this.printQtyVisible() ? `<td class="number">${totalQuantity.toLocaleString('id-ID')}</td>` : ''}<td></td><td></td></tr></tfoot>
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

  private buildRackLetterCodes(): string[] {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}${letter}`);
  }

  private composeRackCreateCode(markDirty = false): void {
    const letterCode = this.rackCreateLetterSearch().trim().toUpperCase();
    const sequence = this.normalizeRackSequence(this.rackCreateSequence());
    const rackCode = this.rackLetterCodes.includes(letterCode) && sequence ? `RCK-${letterCode}-${sequence}` : '';
    this.rackCreateForm.controls.rackCode.setValue(rackCode);
    if (markDirty) {
      this.rackCreateForm.controls.rackCode.markAsTouched();
      this.rackCreateForm.controls.rackCode.markAsDirty();
    }
  }

  private normalizeRackSequence(value: string): string {
    const numberValue = Number(value.replace(/\D/g, ''));
    if (!Number.isFinite(numberValue) || numberValue < 1 || numberValue > 999) return '';
    return String(numberValue).padStart(3, '0');
  }
}
