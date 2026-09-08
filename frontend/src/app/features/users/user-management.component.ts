import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, EMPTY, combineLatest } from 'rxjs';
import { catchError, take, tap, startWith } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { Location, ManagedUser, ManagedUserPayload, RoleOption, UserImportRow } from '../../core/models/api.models';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss'
})
export class UserManagementComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly users = signal<ManagedUser[]>([]);
  readonly roles = signal<RoleOption[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly selectedUser = signal<ManagedUser | null>(null);
  readonly formOpen = signal(false);
  readonly importOpen = signal(false);
  readonly importSuccess = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly importing = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  readonly locationFilter = signal('ALL');
  readonly resetPasswordMode = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(15);
  readonly errorMessage = signal('');
  readonly formErrorMessage = signal('');
  readonly successMessage = signal('');
  readonly importMessage = signal('');
  readonly importErrorMessage = signal('');
  readonly importPreview = signal<UserImportRow[]>([]);

  readonly userForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
    fullName: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(150)]],
    password: ['', [Validators.minLength(6), Validators.maxLength(100)]],
    roleId: [4, [Validators.required]],
    locCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{4}$/)]],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE', [Validators.required]]
  });

  readonly filteredUsers = computed(() => {
    const keyword = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const location = this.locationFilter();
    return this.users().filter((user) => {
      const matchesStatus = status === 'ALL' || user.status === status;
      const matchesLocation = location === 'ALL' || user.locCode === location;
      const matchesKeyword = !keyword || [
        user.username,
        user.fullName,
        user.role.name,
        user.role.code,
        user.locCode
      ].some((value) => value.toLowerCase().includes(keyword));
      return matchesStatus && matchesLocation && matchesKeyword;
    }).sort((a, b) => {
      if (a.locCode !== b.locCode) return a.locCode.localeCompare(b.locCode);
      if (a.role.id !== b.role.id) return a.role.id - b.role.id;
      return a.fullName.localeCompare(b.fullName);
    });
  });

  readonly totalPages = computed(() => Math.ceil(this.filteredUsers().length / this.pageSize()) || 1);
  readonly paginatedUsers = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filteredUsers().slice(start, start + this.pageSize());
  });

  readonly activeCount = computed(() => this.users().filter((user) => user.status === 'ACTIVE').length);
  readonly inactiveCount = computed(() => this.users().filter((user) => user.status !== 'ACTIVE').length);
  readonly importPreviewNames = computed(() => this.importPreview().slice(0, 3).map((row) => row.username).join(', '));

  constructor() {
    this.loadPage();

    combineLatest([
      this.userForm.controls.locCode.valueChanges.pipe(startWith(this.userForm.controls.locCode.value)),
      this.userForm.controls.fullName.valueChanges.pipe(startWith(this.userForm.controls.fullName.value))
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([loc, name]) => {
        if (!this.selectedUser()) {
          const generated = this.generateUsername(loc, name);
          if (this.userForm.controls.username.value !== generated) {
            this.userForm.controls.username.setValue(generated, { emitEvent: false });
          }
        }
      });
  }

  loadPage(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    forkJoin({
      users: this.api.getUsers(),
      roles: this.api.getRoles(),
      locations: this.api.getLocations()
    })
      .pipe(
        tap(({ users, roles, locations }) => {
          this.users.set(users);
          this.roles.set(this.auth.user()?.role.code === 'INVENTORY_CONTROL'
            ? roles
            : roles.filter((role) => role.code !== 'INVENTORY_CONTROL'));
          this.locations.set(locations);
          this.loading.set(false);
        }),
        catchError((error: unknown) => {
          this.errorMessage.set(apiErrorMessage(error, 'Data user gagal dimuat.'));
          this.loading.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  openCreateForm(): void {
    const defaultLoc = this.locations()[0]?.code ?? this.auth.user()?.locCode ?? '';
    const scannerRole = this.roles().find((role) => role.code === 'SCANNER') ?? this.roles()[0];
    this.selectedUser.set(null);
    this.formErrorMessage.set('');
    this.userForm.reset({
      username: '',
      fullName: '',
      password: '',
      roleId: scannerRole?.id ?? 4,
      locCode: defaultLoc,
      status: 'ACTIVE'
    });
    this.resetPasswordMode.set(false);
    this.formOpen.set(true);
  }

  openEditForm(user: ManagedUser): void {
    this.selectedUser.set(user);
    this.formErrorMessage.set('');
    this.userForm.reset({
      username: user.username,
      fullName: user.fullName,
      password: '',
      roleId: user.role.id,
      locCode: user.locCode,
      status: user.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
    });
    this.resetPasswordMode.set(false);
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (!this.saving()) this.formOpen.set(false);
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) this.page.update(p => p + 1);
  }

  prevPage(): void {
    if (this.page() > 1) this.page.update(p => p - 1);
  }

  generateUsername(locCode: string, fullName: string, currentBatch: UserImportRow[] = []): string {
    if (!locCode || !fullName.trim()) return '';
    const parts = fullName.trim().toLowerCase().split(/\s+/);
    let baseName = '';
    if (parts.length === 1) {
      baseName = parts[0];
    } else {
      const first = parts[0];
      const last = parts[parts.length - 1];
      baseName = `${first}${last.charAt(0)}`;
    }
    const cleanBase = baseName.replace(/[^a-z0-9]/g, '');
    if (!cleanBase) return '';

    const baseUsername = `${locCode.toLowerCase()}_${cleanBase}`;
    let finalUsername = baseUsername;
    let counter = 1;
    while (
      this.users().some((u) => u.username.toLowerCase() === finalUsername) ||
      currentBatch.some((u) => u.username.toLowerCase() === finalUsername)
    ) {
      finalUsername = `${baseUsername}${counter}`;
      counter++;
    }
    return finalUsername;
  }

  locationName(locCode: string): string {
    const location = this.locations().find((item) => item.code === locCode);
    return location ? `${location.name} (${location.code})` : locCode;
  }

  roleName(roleId: number): string {
    return this.roles().find((role) => role.id === roleId)?.name ?? String(roleId);
  }

  onPrimaryLocChange(locCode: string): void {
    const normalized = locCode.toUpperCase();
    this.userForm.controls.locCode.setValue(normalized);
  }

  saveUser(): void {
    this.formErrorMessage.set('');
    this.successMessage.set('');
    const selected = this.selectedUser();
    const isNewUser = !selected;
    const isResetting = this.resetPasswordMode();
    const passwordValue = this.userForm.controls.password.value;

    if ((isNewUser || isResetting) && !passwordValue) {
      this.userForm.controls.password.markAsTouched();
      this.formErrorMessage.set('PIN / Password wajib diisi.');
      return;
    }
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }
    const raw = this.userForm.getRawValue();
    const payload: ManagedUserPayload = {
      username: raw.username.trim(),
      fullName: raw.fullName.trim(),
      password: (isNewUser || isResetting) ? raw.password.trim() : undefined,
      roleId: Number(raw.roleId),
      locCode: raw.locCode.trim().toUpperCase(),
      status: raw.status
    };
    this.saving.set(true);
    const request = selected
      ? this.api.updateUser(selected.id, payload)
      : this.api.createUser(payload);
    request
      .pipe(
        tap((user) => {
          this.users.update((users) => selected
            ? users.map((item) => item.id === user.id ? user : item)
            : [user, ...users]);
          this.successMessage.set(selected ? 'User berhasil diperbarui.' : 'User baru berhasil dibuat.');
          this.formOpen.set(false);
          this.saving.set(false);
        }),
        catchError((error: unknown) => {
          this.formErrorMessage.set(apiErrorMessage(error, 'User gagal disimpan.'));
          this.saving.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  async downloadTemplate(): Promise<void> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet('Import Users');
    sheet.columns = [
      { header: 'Nama Lengkap', key: 'fullName', width: 30 },
      { header: 'PIN / Password', key: 'password', width: 20 },
      { header: 'Role', key: 'role', width: 25 },
      { header: 'Lokasi Asli', key: 'location', width: 40 }
    ];

    const dataSheet = workbook.addWorksheet('MasterData', { state: 'hidden' });
    this.roles().forEach((r, idx) => dataSheet.getCell(`A${idx + 1}`).value = r.code);
    this.locations().forEach((l, idx) => dataSheet.getCell(`B${idx + 1}`).value = `${l.name} (${l.code})`);

    const roleCount = this.roles().length;
    const locCount = this.locations().length;

    for (let i = 2; i <= 501; i++) {
      if (roleCount > 0) {
        sheet.getCell(`C${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`MasterData!$A$1:$A$${roleCount}`]
        };
      }
      if (locCount > 0) {
        sheet.getCell(`D${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`MasterData!$B$1:$B$${locCount}`]
        };
      }
    }

    const defaultLocation = this.locations()[0];
    const defaultLocationString = defaultLocation ? `${defaultLocation.name} (${defaultLocation.code})` : '';
    sheet.addRow({
      fullName: 'Scanner Bantuan 01',
      password: '1234',
      role: 'SCANNER',
      location: defaultLocationString
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-import-user-stock-take.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  }

  openImport(): void {
    this.importPreview.set([]);
    this.importMessage.set('');
    this.importErrorMessage.set('');
    this.importSuccess.set(false);
    this.importOpen.set(true);
  }

  closeImport(): void {
    if (!this.importing()) this.importOpen.set(false);
  }

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await file.arrayBuffer();
      await workbook.xlsx.load(arrayBuffer);

      const sheet = workbook.getWorksheet('Import Users');
      if (!sheet) throw new Error('Format file tidak valid. Worksheet "Import Users" tidak ditemukan.');

      const parsedRows: UserImportRow[] = [];

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const fullName = String(row.getCell(1).value ?? '').trim();
        const password = String(row.getCell(2).value ?? '').trim() || undefined;
        const role = String(row.getCell(3).value ?? '').trim().toUpperCase();
        const locString = String(row.getCell(4).value ?? '').trim();

        if (!fullName || !locString) return;

        const locMatch = locString.match(/\(([^)]+)\)$/);
        const locCode = locMatch ? locMatch[1] : locString;

        const username = this.generateUsername(locCode, fullName, parsedRows);

        parsedRows.push({
          username,
          fullName,
          password,
          roleCode: role || 'SCANNER',
          locCode: locCode.toUpperCase(),
          status: 'ACTIVE'
        });
      });

      if (parsedRows.length === 0) throw new Error('File tidak memiliki baris data yang valid.');

      this.importPreview.set(parsedRows);
      this.importErrorMessage.set('');
    } catch (error) {
      this.importPreview.set([]);
      this.importErrorMessage.set(error instanceof Error ? error.message : 'File excel gagal dibaca.');
    }

    input.value = '';
  }

  importUsers(): void {
    const rows = this.importPreview();
    if (rows.length === 0 || this.importing()) return;
    this.importing.set(true);
    this.importMessage.set('');
    this.importErrorMessage.set('');
    this.api.importUsers(rows)
      .pipe(
        tap((result) => {
          this.importMessage.set(`Import selesai. Created ${result.created}, updated ${result.updated}, gagal ${result.failed.length}.`);
          this.importing.set(false);
          this.loadPage();
          if (result.failed.length === 0) {
            this.importSuccess.set(true);
          }
        }),
        catchError((error: unknown) => {
          this.importErrorMessage.set(apiErrorMessage(error, 'Import user gagal.'));
          this.importing.set(false);
          return EMPTY;
        }),
        take(1)
      )
      .subscribe();
  }


}
