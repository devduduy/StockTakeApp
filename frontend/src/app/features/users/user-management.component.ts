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
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly importing = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  readonly locationFilter = signal('ALL');
  readonly resetPasswordMode = signal(false);
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
    });
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

  generateUsername(locCode: string, fullName: string): string {
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
    while (this.users().some((u) => u.username.toLowerCase() === finalUsername)) {
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

  downloadTemplate(): void {
    const rows = [
      ['username', 'fullName', 'password', 'roleCode', 'locCode', 'status'],
      ['scanner_bantuan01', 'Scanner Bantuan 01', 'prototype123', 'SCANNER', this.locations()[0]?.code ?? '6168', 'ACTIVE']
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-import-user-stock-take.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  openImport(): void {
    this.importPreview.set([]);
    this.importMessage.set('');
    this.importErrorMessage.set('');
    this.importOpen.set(true);
  }

  closeImport(): void {
    if (!this.importing()) this.importOpen.set(false);
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.importPreview.set(this.parseCsv(String(reader.result ?? '')));
        this.importErrorMessage.set('');
      } catch (error) {
        this.importPreview.set([]);
        this.importErrorMessage.set(error instanceof Error ? error.message : 'File gagal dibaca.');
      }
    };
    reader.readAsText(file);
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
          if (result.failed.length === 0) this.importOpen.set(false);
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

  private parseCsv(content: string): UserImportRow[] {
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('File import belum memiliki data.');
    const headers = this.splitCsvLine(lines[0]).map((header) => header.trim());
    const required = ['username', 'fullName', 'roleCode', 'locCode'];
    if (required.some((header) => !headers.includes(header))) {
      throw new Error('Header wajib: username, fullName, password, roleCode, locCode, status.');
    }
    return lines.slice(1).map((line) => {
      const values = this.splitCsvLine(line);
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
      return {
        username: record['username']?.trim() ?? '',
        fullName: record['fullName']?.trim() ?? '',
        password: record['password']?.trim() || undefined,
        roleCode: (record['roleCode']?.trim() || 'SCANNER').toUpperCase(),
        locCode: (record['locCode']?.trim() || '').toUpperCase(),
        status: (record['status']?.trim().toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE'
      };
    });
  }

  private splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }
}
