import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, EMPTY, forkJoin, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { Location, RackMaster } from '../../core/models/api.models';

@Component({
  selector: 'app-master-rack',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './master-rack.component.html',
  styleUrl: './master-rack.component.scss'
})
export class MasterRackComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly racks = signal<RackMaster[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly saving = signal(false);
  readonly formOpen = signal(false);
  readonly errorMessage = signal('');
  readonly formErrorMessage = signal('');
  readonly successMessage = signal('');
  readonly search = signal('');
  readonly locationFilter = signal('');
  readonly statusFilter = signal<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  readonly createMode = signal<'SINGLE' | 'BULK'>('SINGLE');

  readonly rackForm = this.fb.nonNullable.group({
    locCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{4}$/)]],
    rackCode: ['', [Validators.required, Validators.pattern(/^RCK-[A-Z]{2}-\d{3}$/)]],
    rackName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', [Validators.required]]
  });
  readonly bulkRackForm = this.fb.nonNullable.group({
    locCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{4}$/)]],
    letterCode: ['', [Validators.required, Validators.pattern(/^[A-Z]{2}$/)]],
    startSequence: [1, [Validators.required, Validators.min(1), Validators.max(999)]],
    count: [10, [Validators.required, Validators.min(1), Validators.max(200)]],
    rackNamePrefix: ['Rack', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', [Validators.required]]
  });

  readonly filteredRacks = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.racks().filter((rack) => {
      const matchesKeyword = !keyword || [
        rack.rackCode,
        rack.rackName,
        rack.locCode,
        this.locationName(rack.locCode)
      ].some((value) => value.toLowerCase().includes(keyword));
      const matchesStatus = status === 'ALL' || rack.status === status;
      return matchesKeyword && matchesStatus;
    });
  });

  readonly activeCount = computed(() => this.racks().filter((rack) => rack.status === 'ACTIVE').length);
  readonly inactiveCount = computed(() => this.racks().filter((rack) => rack.status === 'INACTIVE').length);

  constructor() {
    forkJoin({
      locations: this.api.getLocations(),
      racks: this.api.getRackMasters()
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ locations, racks }) => {
          this.locations.set(locations);
          this.racks.set(racks);
          if (locations.length === 1) {
            this.locationFilter.set(locations[0].code);
          }
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(apiErrorMessage(error, 'Master rack gagal dimuat.'));
          this.loading.set(false);
        }
      });
  }

  refresh(): void {
    if (this.refreshing()) return;
    this.fetchRacks(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  setStatusFilter(status: 'ALL' | 'ACTIVE' | 'INACTIVE'): void {
    this.statusFilter.set(status);
  }

  setLocationFilter(locCode: string): void {
    this.locationFilter.set(locCode);
    this.fetchRacks(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  openCreateForm(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
    this.createMode.set('SINGLE');
    const locCode = this.locationFilter() || this.locations()[0]?.code || '';
    this.rackForm.reset({
      locCode,
      rackCode: '',
      rackName: '',
      status: 'ACTIVE'
    });
    this.bulkRackForm.reset({
      locCode,
      letterCode: '',
      startSequence: 1,
      count: 10,
      rackNamePrefix: 'Rack',
      status: 'ACTIVE'
    });
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (!this.saving()) this.formOpen.set(false);
  }

  createRack(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
    this.normalizeSingleRackCode();
    if (this.rackForm.invalid || this.saving()) {
      this.rackForm.markAllAsTouched();
      return;
    }
    const raw = this.rackForm.getRawValue();
    this.saving.set(true);
    this.api.createRack({
      locCode: raw.locCode,
      rackCode: raw.rackCode.trim(),
      rackName: raw.rackName.trim(),
      status: raw.status
    })
      .pipe(
        switchMap((rack) => {
          this.successMessage.set(`Rack ${rack.rackCode} berhasil dibuat.`);
          this.formOpen.set(false);
          if (!this.locationFilter()) this.locationFilter.set(rack.locCode);
          return this.fetchRacks(false);
        }),
        tap(() => this.saving.set(false)),
        catchError((error: unknown) => {
          this.formErrorMessage.set(apiErrorMessage(error, 'Rack gagal dibuat.'));
          this.saving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  createBulkRacks(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
    this.normalizeBulkLetterCode();
    if (this.bulkRackForm.invalid || this.saving()) {
      this.bulkRackForm.markAllAsTouched();
      return;
    }
    const raw = this.bulkRackForm.getRawValue();
    const lastSequence = Number(raw.startSequence) + Number(raw.count) - 1;
    if (lastSequence > 999) {
      this.formErrorMessage.set('Sequence hasil generate tidak boleh melewati 999.');
      return;
    }
    this.saving.set(true);
    this.api.createRacksBulk({
      locCode: raw.locCode,
      letterCode: raw.letterCode.trim().toUpperCase(),
      startSequence: Number(raw.startSequence),
      count: Number(raw.count),
      rackNamePrefix: raw.rackNamePrefix.trim(),
      status: raw.status
    })
      .pipe(
        switchMap((racks) => {
          this.successMessage.set(`${racks.length} rack berhasil dibuat.`);
          this.formOpen.set(false);
          if (!this.locationFilter()) this.locationFilter.set(raw.locCode);
          return this.fetchRacks(false);
        }),
        tap(() => this.saving.set(false)),
        catchError((error: unknown) => {
          this.formErrorMessage.set(apiErrorMessage(error, 'Generate rack gagal.'));
          this.saving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  bulkPreviewCodes(): string[] {
    const raw = this.bulkRackForm.getRawValue();
    const letterCode = raw.letterCode.trim().toUpperCase();
    const startSequence = Number(raw.startSequence);
    const count = Number(raw.count);
    if (!/^[A-Z]{2}$/.test(letterCode) || startSequence < 1 || count < 1) return [];
    return Array.from({ length: Math.min(count, 6) }, (_, index) => (
      `RCK-${letterCode}-${String(startSequence + index).padStart(3, '0')}`
    ));
  }

  setCreateMode(mode: 'SINGLE' | 'BULK'): void {
    this.createMode.set(mode);
    this.formErrorMessage.set('');
  }

  normalizeSingleRackCode(): void {
    const value = this.rackForm.controls.rackCode.value.trim().toUpperCase();
    this.rackForm.controls.rackCode.setValue(value);
  }

  normalizeBulkLetterCode(): void {
    const value = this.bulkRackForm.controls.letterCode.value.trim().toUpperCase();
    this.bulkRackForm.controls.letterCode.setValue(value);
  }

  locationName(locCode: string): string {
    return this.locations().find((location) => location.code === locCode)?.name ?? locCode;
  }

  private fetchRacks(initial: boolean) {
    initial ? this.loading.set(true) : this.refreshing.set(true);
    this.errorMessage.set('');
    return this.api.getRackMasters(this.locationFilter() || undefined).pipe(
      tap((racks) => {
        this.racks.set(racks);
        this.loading.set(false);
        this.refreshing.set(false);
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Master rack gagal dimuat.'));
        this.loading.set(false);
        this.refreshing.set(false);
        return initial ? of([]) : EMPTY;
      })
    );
  }
}
