import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, finalize } from 'rxjs';
import { StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActiveSchedule, SohScheduleSummary } from '../../core/models/api.models';

@Component({
  selector: 'app-master-soh',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './master-soh.component.html',
  styleUrl: './master-soh.component.scss'
})
export class MasterSohComponent {
  private readonly api = inject(StockTakeApiService);

  readonly schedules = signal<ActiveSchedule[]>([]);
  readonly selectedScheduleId = signal('');
  readonly scheduleKeyword = signal('');
  readonly dateFrom = signal(this.defaultDateFrom());
  readonly dateTo = signal(this.today());
  readonly summary = signal<SohScheduleSummary | null>(null);
  readonly loadingSchedules = signal(false);
  readonly loadingSummary = signal(false);
  readonly generating = signal(false);
  readonly hasSearched = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly selectedSchedule = computed(() =>
    this.schedules().find((schedule) => schedule.id === this.selectedScheduleId()) ?? null
  );
  readonly canGenerate = computed(() =>
    Boolean(this.selectedScheduleId()) && !this.generating() && !this.loadingSchedules() && !this.loadingSummary()
  );

  loadSchedules(): void {
    if (!this.isDateRangeValid()) {
      this.errorMessage.set('Tanggal sampai tidak boleh lebih kecil dari tanggal mulai.');
      return;
    }

    this.loadingSchedules.set(true);
    this.hasSearched.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.summary.set(null);
    this.api.getSchedules({
      scheduleNo: this.scheduleKeyword().trim(),
      startDate: this.dateFrom(),
      endDate: this.dateTo()
    })
      .pipe(
        catchError((error: unknown) => {
          this.schedules.set([]);
          this.selectedScheduleId.set('');
          this.errorMessage.set(apiErrorMessage(error, 'Daftar schedule gagal dimuat.'));
          return EMPTY;
        }),
        finalize(() => this.loadingSchedules.set(false))
      )
      .subscribe((schedules) => {
        this.schedules.set(schedules);
        const selectedStillExists = schedules.some((schedule) => schedule.id === this.selectedScheduleId());
        if (!selectedStillExists) {
          this.selectedScheduleId.set(schedules[0]?.id ?? '');
        }
        this.loadSummary();
      });
  }

  onScheduleChange(scheduleId: string): void {
    this.selectedScheduleId.set(scheduleId);
    this.loadSummary();
  }

  loadSummary(): void {
    const scheduleId = this.selectedScheduleId();
    if (!scheduleId) {
      this.summary.set(null);
      return;
    }

    this.loadingSummary.set(true);
    this.errorMessage.set('');
    this.api.getSohSummary(scheduleId)
      .pipe(
        catchError((error: unknown) => {
          this.summary.set(null);
          this.errorMessage.set(apiErrorMessage(error, 'Summary SOH gagal dimuat.'));
          return EMPTY;
        }),
        finalize(() => this.loadingSummary.set(false))
      )
      .subscribe((summary) => this.summary.set(summary));
  }

  generateSoh(): void {
    const schedule = this.selectedSchedule();
    const summary = this.summary();
    if (!schedule) return;

    const existingText = summary && summary.sohRowCount > 0
      ? `\n\nSOH existing untuk schedule ini (${summary.sohRowCount.toLocaleString('id-ID')} item) akan diganti.`
      : '';
    const confirmed = window.confirm(
      `Generate SOH untuk ${schedule.scheduleNo}?\nLokasi: ${schedule.location.name} (${schedule.locCode})\nCut-off: ${this.shortDate(schedule.cutOffDate)}${existingText}`
    );
    if (!confirmed) return;

    this.generating.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.api.generateSoh(schedule.id)
      .pipe(
        catchError((error: unknown) => {
          this.errorMessage.set(apiErrorMessage(error, 'Generate SOH gagal diproses.'));
          return EMPTY;
        }),
        finalize(() => this.generating.set(false))
      )
      .subscribe((result) => {
        this.summary.set(result);
        this.successMessage.set(
          `SOH berhasil digenerate: ${result.insertedRowCount.toLocaleString('id-ID')} item masuk, ${result.replacedRowCount.toLocaleString('id-ID')} item lama diganti.`
        );
      });
  }

  resetFilters(): void {
    this.scheduleKeyword.set('');
    this.dateFrom.set(this.defaultDateFrom());
    this.dateTo.set(this.today());
    this.schedules.set([]);
    this.selectedScheduleId.set('');
    this.summary.set(null);
    this.hasSearched.set(false);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  shortDate(value: string | Date | null | undefined): string {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  shortDateTime(value: string | null): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private isDateRangeValid(): boolean {
    return !this.dateFrom() || !this.dateTo() || this.dateTo() >= this.dateFrom();
  }

  private today(): string {
    return this.dateInputValue(new Date());
  }

  private defaultDateFrom(): string {
    const date = new Date();
    date.setDate(date.getDate() - 180);
    return this.dateInputValue(date);
  }

  private dateInputValue(date: Date): string {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 10);
  }
}
