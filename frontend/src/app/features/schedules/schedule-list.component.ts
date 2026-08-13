import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, EMPTY, forkJoin, interval, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, Category, Location, RackMaster, SchedulePayload } from '../../core/models/api.models';

interface CategoryGroup {
  divisionId: string;
  divisionName: string;
  departments: Array<{
    departmentId: string;
    departmentName: string;
    categories: Category[];
  }>;
}

@Component({
  selector: 'app-schedule-list',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
  templateUrl: './schedule-list.component.html',
  styleUrl: './schedule-list.component.scss'
})
export class ScheduleListComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly schedules = signal<ActiveSchedule[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly rackMasters = signal<RackMaster[]>([]);
  readonly loading = signal(true);
  readonly racksLoading = signal(false);
  readonly refreshing = signal(false);
  readonly saving = signal(false);
  readonly rackSaving = signal(false);
  readonly errorMessage = signal('');
  readonly formErrorMessage = signal('');
  readonly rackFormErrorMessage = signal('');
  readonly successMessage = signal('');
  readonly search = signal('');
  readonly categorySearch = signal('');
  readonly rackSearch = signal('');
  readonly locationSearch = signal('');
  readonly locationDropdownOpen = signal(false);
  readonly expandedDivisions = signal<Set<string>>(new Set());
  readonly typeFilter = signal<'ALL' | 'PARTIAL' | ''>('');
  readonly formOpen = signal(false);
  readonly editingSchedule = signal<ActiveSchedule | null>(null);
  readonly rackFormOpen = signal(false);
  readonly scheduleForm = this.fb.nonNullable.group({
    scheduleDesc: [''],
    locCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{4}$/)]],
    startDate: ['', [Validators.required]],
    endDate: ['', [Validators.required]],
    cutOffDate: ['', [Validators.required]],
    startTime: [''],
    endTime: [''],
    stockType: ['ALL' as 'ALL' | 'PARTIAL', [Validators.required]],
    status: ['OPEN' as 'DRAFT' | 'OPEN', [Validators.required]],
    categoryIds: this.fb.nonNullable.control<string[]>([]),
    rackIds: this.fb.nonNullable.control<string[]>([])
  });
  readonly rackForm = this.fb.nonNullable.group({
    rackCode: ['', [Validators.required, Validators.pattern(/^RCK-[A-Z]{2}-\d{3}$/)]],
    rackName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', [Validators.required]]
  });
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
  readonly filteredCategoryGroups = computed<CategoryGroup[]>(() => {
    const keyword = this.categorySearch().trim().toLowerCase();
    const grouped = new Map<string, CategoryGroup>();
    for (const category of this.categories()) {
      const matches = !keyword || [
        category.id,
        category.name,
        category.department.name,
        category.division.name
      ].some((value) => value.toLowerCase().includes(keyword));
      if (!matches) continue;

      const divisionKey = category.division.id;
      const group = grouped.get(divisionKey) ?? {
        divisionId: category.division.id,
        divisionName: category.division.name,
        departments: []
      };
      let department = group.departments.find((item) => item.departmentId === category.department.id);
      if (!department) {
        department = {
          departmentId: category.department.id,
          departmentName: category.department.name,
          categories: []
        };
        group.departments.push(department);
      }
      department.categories.push(category);
      grouped.set(divisionKey, group);
    }
    return [...grouped.values()];
  });
  readonly filteredRackMasters = computed(() => {
    const keyword = this.rackSearch().trim().toLowerCase();
    return this.rackMasters()
      .filter((rack) => rack.status === 'ACTIVE')
      .filter((rack) => !keyword || [
        rack.rackCode,
        rack.rackName,
        rack.locCode
      ].some((value) => value.toLowerCase().includes(keyword)));
  });
  readonly filteredLocations = computed(() => {
    const keyword = this.locationSearch().trim().toLowerCase();
    if (!keyword) return this.locations();
    return this.locations().filter((location) =>
      this.locationDisplay(location).toLowerCase().includes(keyword)
      || location.code.toLowerCase().includes(keyword)
      || location.name.toLowerCase().includes(keyword)
    );
  });

  constructor() {
    interval(30_000)
      .pipe(
        switchMap(() => this.fetchSchedules(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
    forkJoin({
      categories: this.api.getCategories(),
      locations: this.api.getLocations(),
      schedules: this.fetchSchedules(true)
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ categories, locations }) => {
        this.categories.set(categories);
        this.locations.set(locations);
        this.expandedDivisions.set(new Set(categories.slice(0, 1).map((category) => category.division.id)));
        if (locations.length === 1) this.selectLocation(locations[0], false);
      });

    this.scheduleForm.controls.locCode.valueChanges
      .pipe(
        distinctUntilChanged(),
        tap(() => {
          this.scheduleForm.controls.rackIds.setValue([]);
          this.rackSearch.set('');
          this.loadRackMasters();
        }),
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

  openCreateForm(): void {
    const today = new Date().toISOString().slice(0, 10);
    const location = this.locations().length === 1 ? this.locations()[0] : null;
    this.editingSchedule.set(null);
    this.formErrorMessage.set('');
    this.rackSearch.set('');
    this.rackFormErrorMessage.set('');
    this.rackFormOpen.set(false);
    this.scheduleForm.reset({
      scheduleDesc: '',
      locCode: location?.code ?? '',
      startDate: today,
      endDate: today,
      cutOffDate: today,
      startTime: '08:00',
      endTime: '',
      stockType: 'ALL',
      status: 'OPEN',
      categoryIds: [],
      rackIds: []
    });
    this.locationDropdownOpen.set(false);
    this.locationSearch.set(location ? this.locationDisplay(location) : '');
    this.loadRackMasters();
    this.formOpen.set(true);
  }

  openEditForm(schedule: ActiveSchedule): void {
    this.editingSchedule.set(schedule);
    this.formErrorMessage.set('');
    this.rackSearch.set('');
    this.rackFormErrorMessage.set('');
    this.rackFormOpen.set(false);
    this.scheduleForm.reset({
      scheduleDesc: schedule.scheduleDesc,
      locCode: schedule.locCode,
      startDate: schedule.startDate ?? schedule.scheduleDate,
      endDate: schedule.endDate ?? schedule.scheduleDate,
      cutOffDate: schedule.cutOffDate ?? schedule.scheduleDate,
      startTime: this.timeValue(schedule.startTime),
      endTime: this.timeValue(schedule.endTime),
      stockType: this.stockTypeLabel(schedule),
      status: schedule.status === 'DRAFT' ? 'DRAFT' : 'OPEN',
      categoryIds: [...schedule.categoryIds],
      rackIds: [...schedule.rackIds]
    });
    this.locationSearch.set(this.locationDisplayByCode(schedule.locCode));
    this.scheduleForm.controls.rackIds.setValue([...schedule.rackIds]);
    this.loadRackMasters();
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (!this.saving()) this.formOpen.set(false);
  }

  selectedCategoryIds(): string[] {
    return this.scheduleForm.controls.categoryIds.value;
  }

  locationReady(): boolean {
    return this.scheduleForm.controls.locCode.valid
      && Boolean(this.scheduleForm.controls.locCode.value)
      && this.locations().some((location) => location.code === this.scheduleForm.controls.locCode.value);
  }

  locationDisplay(location: Location): string {
    return `${location.name} (${location.code})`;
  }

  locationDisplayByCode(locCode: string): string {
    const location = this.locations().find((item) => item.code === locCode);
    return location ? this.locationDisplay(location) : '';
  }

  onLocationFocus(): void {
    this.locationDropdownOpen.set(true);
  }

  onLocationInput(value: string): void {
    this.locationSearch.set(value);
    this.locationDropdownOpen.set(true);
    const matched = this.matchLocation(value);
    this.scheduleForm.controls.locCode.setValue(matched?.code ?? '');
    if (!matched) {
      this.scheduleForm.controls.locCode.markAsTouched();
    }
  }

  onLocationBlur(): void {
    window.setTimeout(() => {
      const matched = this.matchLocation(this.locationSearch());
      if (matched) {
        this.selectLocation(matched);
      } else if (!this.locationSearch().trim()) {
        this.scheduleForm.controls.locCode.setValue('');
      } else {
        this.scheduleForm.controls.locCode.setValue('');
        this.scheduleForm.controls.locCode.markAsTouched();
      }
      this.locationDropdownOpen.set(false);
    }, 120);
  }

  selectLocation(location: Location, markTouched = true): void {
    this.locationSearch.set(this.locationDisplay(location));
    this.locationDropdownOpen.set(false);
    this.scheduleForm.controls.locCode.setValue(location.code);
    if (markTouched) {
      this.scheduleForm.controls.locCode.markAsTouched();
      this.scheduleForm.controls.locCode.markAsDirty();
    }
  }

  selectedRackIds(): string[] {
    return this.scheduleForm.controls.rackIds.value;
  }

  selectedRackMasters(): RackMaster[] {
    const selected = new Set(this.selectedRackIds());
    return this.rackMasters().filter((rack) => selected.has(rack.id));
  }

  selectedCategories(): Category[] {
    const selected = new Set(this.selectedCategoryIds());
    return this.categories().filter((category) => selected.has(category.id));
  }

  categoryChecked(categoryId: string): boolean {
    return this.selectedCategoryIds().includes(categoryId);
  }

  toggleCategory(categoryId: string, checked: boolean): void {
    const current = new Set(this.selectedCategoryIds());
    checked ? current.add(categoryId) : current.delete(categoryId);
    this.scheduleForm.controls.categoryIds.setValue([...current]);
    this.scheduleForm.controls.categoryIds.markAsDirty();
  }

  toggleDivision(divisionId: string): void {
    const expanded = new Set(this.expandedDivisions());
    expanded.has(divisionId) ? expanded.delete(divisionId) : expanded.add(divisionId);
    this.expandedDivisions.set(expanded);
  }

  divisionExpanded(divisionId: string): boolean {
    return this.expandedDivisions().has(divisionId);
  }

  checkedState(categories: Category[]): 'none' | 'partial' | 'all' {
    const selected = new Set(this.selectedCategoryIds());
    const selectedCount = categories.filter((category) => selected.has(category.id)).length;
    if (selectedCount === 0) return 'none';
    return selectedCount === categories.length ? 'all' : 'partial';
  }

  toggleCategoryGroup(categories: Category[], checked: boolean): void {
    const current = new Set(this.selectedCategoryIds());
    for (const category of categories) {
      checked ? current.add(category.id) : current.delete(category.id);
    }
    this.scheduleForm.controls.categoryIds.setValue([...current]);
    this.scheduleForm.controls.categoryIds.markAsDirty();
  }

  clearCategories(): void {
    this.scheduleForm.controls.categoryIds.setValue([]);
  }

  removeCategory(categoryId: string): void {
    this.toggleCategory(categoryId, false);
  }

  rackChecked(rackId: string): boolean {
    return this.selectedRackIds().includes(rackId);
  }

  toggleRack(rackId: string, checked: boolean): void {
    const current = new Set(this.selectedRackIds());
    checked ? current.add(rackId) : current.delete(rackId);
    this.scheduleForm.controls.rackIds.setValue([...current]);
    this.scheduleForm.controls.rackIds.markAsDirty();
  }

  toggleAllFilteredRacks(checked: boolean): void {
    const current = new Set(this.selectedRackIds());
    for (const rack of this.filteredRackMasters()) {
      checked ? current.add(rack.id) : current.delete(rack.id);
    }
    this.scheduleForm.controls.rackIds.setValue([...current]);
    this.scheduleForm.controls.rackIds.markAsDirty();
  }

  clearRacks(): void {
    this.scheduleForm.controls.rackIds.setValue([]);
  }

  removeRack(rackId: string): void {
    this.toggleRack(rackId, false);
  }

  openRackForm(): void {
    if (!this.locationReady()) {
      this.scheduleForm.controls.locCode.markAsTouched();
      return;
    }
    this.rackFormErrorMessage.set('');
    this.rackForm.reset({
      rackCode: '',
      rackName: '',
      status: 'ACTIVE'
    });
    this.rackFormOpen.set(true);
  }

  closeRackForm(): void {
    if (!this.rackSaving()) this.rackFormOpen.set(false);
  }

  createRack(): void {
    if (!this.locationReady()) {
      this.rackFormErrorMessage.set('Pilih lokasi terlebih dahulu sebelum menambah rack.');
      return;
    }
    this.normalizeRackCode();
    if (this.rackForm.invalid || this.rackSaving()) {
      this.rackForm.markAllAsTouched();
      return;
    }
    const locCode = this.scheduleForm.controls.locCode.value;
    const raw = this.rackForm.getRawValue();
    this.rackSaving.set(true);
    this.rackFormErrorMessage.set('');
    this.api.createRack({
      rackCode: raw.rackCode.trim(),
      rackName: raw.rackName.trim(),
      locCode,
      status: raw.status
    })
      .pipe(
        switchMap((rack) => {
          if (this.scheduleForm.controls.stockType.value === 'PARTIAL') {
            this.toggleRack(rack.id, true);
          }
          return this.fetchRackMasters(locCode);
        }),
        tap(() => {
          this.rackSaving.set(false);
          this.rackFormOpen.set(false);
        }),
        catchError((error: unknown) => {
          this.rackFormErrorMessage.set(apiErrorMessage(error, 'Rack gagal dibuat.'));
          this.rackSaving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  normalizeRackCode(): void {
    const value = this.rackForm.controls.rackCode.value.trim().toUpperCase();
    this.rackForm.controls.rackCode.setValue(value);
  }

  divisionCategories(group: CategoryGroup): Category[] {
    return group.departments.flatMap((department) => department.categories);
  }

  canEdit(schedule: ActiveSchedule): boolean {
    return schedule.progress.rackWithSubmittedScan === 0 && ['DRAFT', 'OPEN'].includes(schedule.status);
  }

  submitSchedule(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
    if (!this.locationReady()) {
      this.scheduleForm.controls.locCode.markAsTouched();
      this.formErrorMessage.set('Pilih lokasi terlebih dahulu sebelum menyimpan schedule.');
      return;
    }
    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      return;
    }
    const payload = this.schedulePayload();
    if (payload.endDate < payload.startDate) {
      this.formErrorMessage.set('Tanggal selesai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }
    if (payload.startDate === payload.endDate && payload.startTime && payload.endTime && payload.endTime < payload.startTime) {
      this.formErrorMessage.set('Jam selesai tidak boleh lebih kecil dari jam mulai untuk tanggal yang sama.');
      return;
    }
    if (payload.stockType === 'PARTIAL' && payload.categoryIds.length === 0) {
      this.formErrorMessage.set('Pilih minimal satu category untuk schedule PARTIAL.');
      return;
    }
    if (payload.stockType === 'PARTIAL' && payload.rackIds.length === 0) {
      this.formErrorMessage.set('Pilih minimal satu rack untuk schedule PARTIAL.');
      return;
    }
    if (payload.stockType === 'ALL' && this.filteredActiveRackCount() === 0) {
      this.formErrorMessage.set('Lokasi ini belum memiliki rack aktif. Buat Master Rack terlebih dahulu sebelum membuat schedule.');
      return;
    }
    this.saving.set(true);
    const editing = this.editingSchedule();
    const request = editing
      ? this.api.updateSchedule(editing.id, payload)
      : this.api.createSchedule(payload);
    request
      .pipe(
        switchMap(() => this.fetchSchedules(false)),
        tap(() => {
          this.successMessage.set(editing ? 'Schedule berhasil diperbarui.' : 'Schedule baru berhasil dibuat.');
          this.formOpen.set(false);
          this.saving.set(false);
        }),
        catchError((error: unknown) => {
          this.formErrorMessage.set(apiErrorMessage(error, 'Schedule gagal disimpan.'));
          this.saving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  statusLabel(status: string): string {
    return ({ DRAFT: 'Draft', OPEN: 'Open', IN_PROGRESS: 'Inprogress', COMPLETED: 'Completed', CLOSED: 'Closed' } as Record<string, string>)[status] || status;
  }

  stockTypeLabel(schedule: ActiveSchedule): 'ALL' | 'PARTIAL' {
    return schedule.stockType.code.includes('PARTIAL') ? 'PARTIAL' : 'ALL';
  }

  locationName(locCode: string): string {
    return this.locations().find((location) => location.code === locCode)?.name ?? locCode;
  }

  categorySummary(schedule: ActiveSchedule): string {
    if (this.stockTypeLabel(schedule) === 'ALL') return 'Semua kategori barang';
    if (schedule.categories.length === 0) return `${schedule.categoryIds.length} kategori terpilih`;
    const names = schedule.categories.slice(0, 2).map((category) => category.name).join(', ');
    const remaining = schedule.categories.length - 2;
    return remaining > 0 ? `${names} +${remaining} lainnya` : names;
  }

  filteredActiveRackCount(): number {
    return this.rackMasters().filter((rack) => rack.status === 'ACTIVE').length;
  }

  generatedScheduleDescription(): string {
    return this.buildScheduleDescription();
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

  private loadRackMasters(): void {
    this.fetchRackMasters(this.scheduleForm.controls.locCode.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  private fetchRackMasters(locCode: string) {
    if (!locCode) {
      this.rackMasters.set([]);
      return of([]);
    }
    this.racksLoading.set(true);
    return this.api.getRackMasters(locCode).pipe(
      tap((racks) => {
        this.rackMasters.set(racks);
        this.racksLoading.set(false);
      }),
      catchError((error: unknown) => {
        console.warn(apiErrorMessage(error, 'Rack lokasi gagal dimuat.'));
        this.rackMasters.set([]);
        this.racksLoading.set(false);
        return of([]);
      })
    );
  }

  private schedulePayload(): SchedulePayload {
    const raw = this.scheduleForm.getRawValue();
    return {
      scheduleDesc: this.buildScheduleDescription(),
      locCode: raw.locCode,
      startDate: raw.startDate,
      endDate: raw.endDate,
      cutOffDate: raw.cutOffDate,
      startTime: raw.startTime || null,
      endTime: raw.endTime || null,
      stockType: raw.stockType,
      categoryIds: raw.stockType === 'ALL' ? [] : raw.categoryIds,
      rackIds: raw.stockType === 'ALL' ? [] : raw.rackIds,
      status: raw.status
    };
  }

  private timeValue(value: string | null): string {
    return value ? new Date(value).toISOString().slice(11, 16) : '';
  }

  private buildScheduleDescription(): string {
    const raw = this.scheduleForm.getRawValue();
    if (!raw.locCode || !raw.stockType || !raw.cutOffDate) {
      return '';
    }
    return `STOCK TAKE ${raw.locCode.toUpperCase()} ${raw.stockType} ${raw.cutOffDate}`;
  }

  private matchLocation(value: string): Location | undefined {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    return this.locations().find((location) =>
      location.code.toLowerCase() === normalized
      || this.locationDisplay(location).toLowerCase() === normalized
    );
  }
}
