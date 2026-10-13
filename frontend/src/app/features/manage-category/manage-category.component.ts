import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, forkJoin, switchMap, tap } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Category, CategoryTemplate, CategoryTemplatePayload } from '../../core/models/api.models';

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
  selector: 'app-manage-category',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './manage-category.component.html',
  styleUrl: './manage-category.component.scss'
})
export class ManageCategoryComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly templates = signal<CategoryTemplate[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly saving = signal(false);
  readonly formOpen = signal(false);
  readonly selectedTemplate = signal<CategoryTemplate | null>(null);
  readonly errorMessage = signal('');
  readonly formErrorMessage = signal('');
  readonly successMessage = signal('');
  readonly search = signal('');
  readonly categorySearch = signal('');
  readonly expandedDivisions = signal<Set<string>>(new Set());
  readonly page = signal(1);
  readonly pageSize = signal(12);

  readonly canManage = computed(() => this.auth.user()?.role.code === 'INVENTORY_CONTROL');

  readonly templateForm = this.fb.nonNullable.group({
    templateName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    description: [''],
    categoryIds: this.fb.nonNullable.control<string[]>([])
  });

  readonly filteredTemplates = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    return this.templates().filter((template) => {
      const categoryNames = template.categories.map((category) => category.name).join(' ');
      return !keyword || [
        template.templateName,
        template.description ?? '',
        template.status,
        categoryNames
      ].some((value) => value.toLowerCase().includes(keyword));
    });
  });

  readonly totalPages = computed(() => Math.ceil(this.filteredTemplates().length / this.pageSize()) || 1);
  readonly paginatedTemplates = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filteredTemplates().slice(start, start + this.pageSize());
  });
  readonly activeCount = computed(() => this.templates().filter((template) => template.status === 'ACTIVE').length);
  readonly inactiveCount = computed(() => this.templates().filter((template) => template.status !== 'ACTIVE').length);

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

      const group = grouped.get(category.division.id) ?? {
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
      grouped.set(category.division.id, group);
    }
    return [...grouped.values()];
  });

  constructor() {
    this.loadInitialData();
  }

  refresh(): void {
    if (this.refreshing()) return;
    this.fetchTemplates(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  openCreateForm(): void {
    this.formErrorMessage.set('');
    this.selectedTemplate.set(null);
    this.categorySearch.set('');
    this.templateForm.reset({
      templateName: '',
      description: '',
      categoryIds: []
    });
    this.expandFirstDivision();
    this.formOpen.set(true);
  }

  openEditForm(template: CategoryTemplate): void {
    this.formErrorMessage.set('');
    this.selectedTemplate.set(template);
    this.categorySearch.set('');
    this.templateForm.reset({
      templateName: template.templateName,
      description: template.description ?? '',
      categoryIds: [...template.categoryIds]
    });
    this.expandSelectedDivisions(template.categoryIds);
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (!this.saving()) this.formOpen.set(false);
  }

  saveTemplate(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
    if (!this.canManage()) {
      this.formErrorMessage.set('Hanya Inventory Control yang boleh mengelola template category.');
      return;
    }
    if (this.templateForm.invalid || this.saving()) {
      this.templateForm.markAllAsTouched();
      return;
    }
    const payload = this.templatePayload();
    if (payload.categoryIds.length === 0) {
      this.formErrorMessage.set('Pilih minimal satu category untuk template.');
      return;
    }

    const selected = this.selectedTemplate();
    this.saving.set(true);
    const request = selected
      ? this.api.updateCategoryTemplate(selected.id, payload)
      : this.api.createCategoryTemplate(payload);

    request.pipe(
      switchMap((template) => {
        this.successMessage.set(selected
          ? `Template ${template.templateName} berhasil diupdate.`
          : `Template ${template.templateName} berhasil dibuat.`);
        this.formOpen.set(false);
        return this.fetchTemplates(false);
      }),
      tap(() => this.saving.set(false)),
      catchError((error: unknown) => {
        this.formErrorMessage.set(apiErrorMessage(error, 'Template category gagal disimpan.'));
        this.saving.set(false);
        return EMPTY;
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  deactivateTemplate(template: CategoryTemplate): void {
    if (!this.canManage()) {
      this.errorMessage.set('Hanya Inventory Control yang boleh mengelola template category.');
      return;
    }
    if (!confirm(`Nonaktifkan template ${template.templateName}? Schedule lama tidak akan berubah.`)) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.api.deactivateCategoryTemplate(template.id).pipe(
      switchMap(() => {
        this.successMessage.set(`Template ${template.templateName} berhasil dinonaktifkan.`);
        return this.fetchTemplates(false);
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Template category gagal dinonaktifkan.'));
        this.loading.set(false);
        return EMPTY;
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  activateTemplate(template: CategoryTemplate): void {
    if (!this.canManage()) {
      this.errorMessage.set('Hanya Inventory Control yang boleh mengelola template category.');
      return;
    }
    if (!confirm(`Aktifkan kembali template ${template.templateName}?`)) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.api.activateCategoryTemplate(template.id).pipe(
      switchMap(() => {
        this.successMessage.set(`Template ${template.templateName} berhasil diaktifkan.`);
        return this.fetchTemplates(false);
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Template category gagal diaktifkan.'));
        this.loading.set(false);
        return EMPTY;
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  selectedCategoryIds(): string[] {
    return this.templateForm.controls.categoryIds.value;
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
    this.templateForm.controls.categoryIds.setValue([...current]);
    this.templateForm.controls.categoryIds.markAsDirty();
  }

  toggleCategoryGroup(categories: Category[], checked: boolean): void {
    const current = new Set(this.selectedCategoryIds());
    for (const category of categories) {
      checked ? current.add(category.id) : current.delete(category.id);
    }
    this.templateForm.controls.categoryIds.setValue([...current]);
    this.templateForm.controls.categoryIds.markAsDirty();
  }

  clearCategories(): void {
    this.templateForm.controls.categoryIds.setValue([]);
  }

  removeCategory(categoryId: string): void {
    this.toggleCategory(categoryId, false);
  }

  divisionCategories(group: CategoryGroup): Category[] {
    return group.departments.flatMap((department) => department.categories);
  }

  checkedState(categories: Category[]): 'none' | 'partial' | 'all' {
    const selected = new Set(this.selectedCategoryIds());
    const selectedCount = categories.filter((category) => selected.has(category.id)).length;
    if (selectedCount === 0) return 'none';
    return selectedCount === categories.length ? 'all' : 'partial';
  }

  toggleDivision(divisionId: string): void {
    const expanded = new Set(this.expandedDivisions());
    expanded.has(divisionId) ? expanded.delete(divisionId) : expanded.add(divisionId);
    this.expandedDivisions.set(expanded);
  }

  divisionExpanded(divisionId: string): boolean {
    return this.expandedDivisions().has(divisionId);
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) this.page.update((page) => page + 1);
  }

  prevPage(): void {
    if (this.page() > 1) this.page.update((page) => page - 1);
  }

  categorySummary(template: CategoryTemplate): string {
    if (template.categories.length === 0) return `${template.categoryCount} category`;
    const names = template.categories.slice(0, 3).map((category) => category.name).join(', ');
    const remaining = template.categories.length - 3;
    return remaining > 0 ? `${names} +${remaining} lainnya` : names;
  }

  updatedAt(template: CategoryTemplate): string {
    const value = template.dateModified ?? template.dateCreated;
    if (!value) return '-';
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  private loadInitialData(): void {
    forkJoin({
      categories: this.api.getCategories(),
      templates: this.api.getCategoryTemplates()
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ categories, templates }) => {
          this.categories.set(categories);
          this.templates.set(templates);
          this.expandFirstDivision();
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(apiErrorMessage(error, 'Manage category gagal dimuat.'));
          this.loading.set(false);
        }
      });
  }

  private fetchTemplates(showLoading: boolean) {
    showLoading ? this.loading.set(true) : this.refreshing.set(true);
    this.errorMessage.set('');
    return this.api.getCategoryTemplates().pipe(
      tap((templates) => {
        this.templates.set(templates);
        this.loading.set(false);
        this.refreshing.set(false);
      }),
      catchError((error: unknown) => {
        this.errorMessage.set(apiErrorMessage(error, 'Template category gagal dimuat.'));
        this.loading.set(false);
        this.refreshing.set(false);
        return EMPTY;
      })
    );
  }

  private templatePayload(): CategoryTemplatePayload {
    const raw = this.templateForm.getRawValue();
    return {
      templateName: raw.templateName.trim(),
      description: raw.description.trim() || null,
      categoryIds: raw.categoryIds
    };
  }

  private expandFirstDivision(): void {
    const first = this.categories()[0]?.division.id;
    this.expandedDivisions.set(first ? new Set([first]) : new Set());
  }

  private expandSelectedDivisions(categoryIds: string[]): void {
    const selected = new Set(categoryIds);
    const divisions = this.categories()
      .filter((category) => selected.has(category.id))
      .map((category) => category.division.id);
    this.expandedDivisions.set(new Set(divisions.length > 0 ? divisions : [this.categories()[0]?.division.id ?? ''].filter(Boolean)));
  }
}
