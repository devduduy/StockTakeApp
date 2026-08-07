import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, forkJoin, interval, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, Category, Location, SchedulePayload } from '../../core/models/api.models';

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
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly formErrorMessage = signal('');
  readonly successMessage = signal('');
  readonly search = signal('');
  readonly categorySearch = signal('');
  readonly expandedDivisions = signal<Set<string>>(new Set());
  readonly typeFilter = signal<'ALL' | 'PARTIAL' | ''>('');
  readonly formOpen = signal(false);
  readonly editingSchedule = signal<ActiveSchedule | null>(null);
  readonly scheduleForm = this.fb.nonNullable.group({
    scheduleDesc: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(250)]],
    locCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{4}$/)]],
    startDate: ['', [Validators.required]],
    endDate: ['', [Validators.required]],
    startTime: [''],
    endTime: [''],
    stockType: ['ALL' as 'ALL' | 'PARTIAL', [Validators.required]],
    status: ['OPEN' as 'DRAFT' | 'OPEN', [Validators.required]],
    categoryIds: this.fb.nonNullable.control<string[]>([])
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
        if (locations[0]) this.scheduleForm.controls.locCode.setValue(locations[0].code);
      });
  }

  refresh(): void {
    if (!this.refreshing()) this.fetchSchedules(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  setTypeFilter(type: 'ALL' | 'PARTIAL' | ''): void {
    this.typeFilter.set(type);
  }

  openCreateForm(): void {
    const today = new Date().toISOString().slice(0, 10);
    const location = this.locations()[0];
    this.editingSchedule.set(null);
    this.formErrorMessage.set('');
    this.scheduleForm.reset({
      scheduleDesc: '',
      locCode: location?.code ?? '',
      startDate: today,
      endDate: today,
      startTime: '08:00',
      endTime: '',
      stockType: 'ALL',
      status: 'OPEN',
      categoryIds: []
    });
    this.formOpen.set(true);
  }

  openEditForm(schedule: ActiveSchedule): void {
    this.editingSchedule.set(schedule);
    this.formErrorMessage.set('');
    this.scheduleForm.reset({
      scheduleDesc: schedule.scheduleDesc,
      locCode: schedule.locCode,
      startDate: schedule.startDate ?? schedule.scheduleDate,
      endDate: schedule.endDate ?? schedule.scheduleDate,
      startTime: this.timeValue(schedule.startTime),
      endTime: this.timeValue(schedule.endTime),
      stockType: this.stockTypeLabel(schedule),
      status: schedule.status === 'DRAFT' ? 'DRAFT' : 'OPEN',
      categoryIds: [...schedule.categoryIds]
    });
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (!this.saving()) this.formOpen.set(false);
  }

  selectedCategoryIds(): string[] {
    return this.scheduleForm.controls.categoryIds.value;
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

  divisionCategories(group: CategoryGroup): Category[] {
    return group.departments.flatMap((department) => department.categories);
  }

  canEdit(schedule: ActiveSchedule): boolean {
    return schedule.progress.rackWithSubmittedScan === 0 && ['DRAFT', 'OPEN'].includes(schedule.status);
  }

  submitSchedule(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
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
    return ({ DRAFT: 'Draft', OPEN: 'Open', IN_PROGRESS: 'Inprogress', COMPLETED: 'Completed' } as Record<string, string>)[status] || status;
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
        this.errorMessage.set(apiErrorMessage(error, 'Schedule gagal dimuat.'));
        this.loading.set(false);
        this.refreshing.set(false);
        return initial ? of([]) : EMPTY;
      })
    );
  }

  private schedulePayload(): SchedulePayload {
    const raw = this.scheduleForm.getRawValue();
    return {
      scheduleDesc: raw.scheduleDesc.trim(),
      locCode: raw.locCode,
      startDate: raw.startDate,
      endDate: raw.endDate,
      startTime: raw.startTime || null,
      endTime: raw.endTime || null,
      stockType: raw.stockType,
      categoryIds: raw.stockType === 'ALL' ? [] : raw.categoryIds,
      status: raw.status
    };
  }

  private timeValue(value: string | null): string {
    return value ? new Date(value).toISOString().slice(11, 16) : '';
  }
}
