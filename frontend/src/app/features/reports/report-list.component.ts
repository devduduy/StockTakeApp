import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, finalize, forkJoin } from 'rxjs';
import { ScheduleQueryFilters, StockTakeApiService } from '../../core/api/stock-take-api.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import {
  ActiveSchedule,
  AddressReportRow,
  Category,
  CategorySummaryReportRow,
  Location,
  StockTakeReportBundle,
  VarianceReportRow
} from '../../core/models/api.models';

export type ReportType = 'ADDRESS' | 'CATEGORY' | 'VARIANCE' | 'TOP_BOTTOM';

interface ReportConfig {
  type: ReportType;
  eyebrow: string;
  title: string;
  listTitle: string;
  description: string;
  exportLabel: string;
  exportIcon: string;
}

interface TopBottomRow {
  no: number;
  stockTakeRequestNumber: string;
  store: string;
  category: string;
  article: string;
  itemBarcode: string;
  articleDescription: string;
  sohQty: number;
  qtyCounted: number;
  diffQty: number;
  diffValue: number;
}

const REPORT_CONFIGS: Record<ReportType, ReportConfig> = {
  ADDRESS: {
    type: 'ADDRESS',
    eyebrow: 'REPORTING / ADDRESS',
    title: 'Stock Take Report By Address',
    listTitle: 'Stock Take Address List',
    description: 'Inquiry schedule untuk export detail hasil scan per rack/address.',
    exportLabel: 'Export CSV',
    exportIcon: 'download'
  },
  CATEGORY: {
    type: 'CATEGORY',
    eyebrow: 'REPORTING / CATEGORY',
    title: 'Stock Take Report by Category',
    listTitle: 'Stock Take Category List',
    description: 'Inquiry schedule untuk cetak posting summary by category.',
    exportLabel: 'Export PDF',
    exportIcon: 'picture_as_pdf'
  },
  VARIANCE: {
    type: 'VARIANCE',
    eyebrow: 'REPORTING / VARIANCE',
    title: 'Stock Take Variance Report',
    listTitle: 'Stock Take Variance List',
    description: 'Inquiry schedule untuk export detail variance SOH vs counted.',
    exportLabel: 'Export CSV',
    exportIcon: 'download'
  },
  TOP_BOTTOM: {
    type: 'TOP_BOTTOM',
    eyebrow: 'REPORTING / TOP BOTTOM',
    title: 'Top / Bottom 30',
    listTitle: 'Top / Bottom 30 Schedule List',
    description: 'Inquiry schedule untuk cetak Top 30 Plus dan Top 30 Minus by category.',
    exportLabel: 'Export PDF',
    exportIcon: 'picture_as_pdf'
  }
};

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-list.component.html',
  styleUrl: './report-list.component.scss'
})
export class ReportListComponent {
  private readonly api = inject(StockTakeApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly reportType = signal<ReportType>('ADDRESS');
  readonly schedules = signal<ActiveSchedule[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly locations = signal<Location[]>([]);
  readonly selectedScheduleIds = signal<Set<string>>(new Set());
  readonly scheduleNo = signal('');
  readonly selectedCategoryId = signal('');
  readonly selectedLocCode = signal('');
  readonly dateFrom = signal(this.defaultDateFrom());
  readonly dateTo = signal(this.today());
  readonly page = signal(1);
  readonly pageSize = 25;
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly warningMessage = signal('');

  readonly config = computed(() => REPORT_CONFIGS[this.reportType()]);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.schedules().length / this.pageSize)));
  readonly pageStart = computed(() => this.schedules().length === 0 ? 0 : (this.page() - 1) * this.pageSize + 1);
  readonly pageEnd = computed(() => Math.min(this.page() * this.pageSize, this.schedules().length));
  readonly pagedSchedules = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.schedules().slice(start, start + this.pageSize);
  });
  readonly selectedCount = computed(() => this.selectedScheduleIds().size);
  readonly allVisibleSelected = computed(() => {
    const rows = this.pagedSchedules();
    return rows.length > 0 && rows.every((schedule) => this.selectedScheduleIds().has(schedule.id));
  });
  readonly someVisibleSelected = computed(() => {
    const rows = this.pagedSchedules();
    return rows.some((schedule) => this.selectedScheduleIds().has(schedule.id)) && !this.allVisibleSelected();
  });
  readonly selectedCategory = computed(() =>
    this.categories().find((category) => category.id === this.selectedCategoryId()) ?? null
  );

  constructor() {
    this.loadReferenceData();
    this.route.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        this.reportType.set((data['reportType'] as ReportType | undefined) ?? 'ADDRESS');
        this.clearSelection();
        this.page.set(1);
        this.search();
      });
  }

  loadReferenceData(): void {
    this.api.getCategories()
      .pipe(catchError(() => EMPTY))
      .subscribe((categories) => this.categories.set(categories));
    this.api.getLocations()
      .pipe(catchError(() => EMPTY))
      .subscribe((locations) => this.locations.set(locations));
  }

  search(): void {
    if (!this.isDateRangeValid()) {
      this.errorMessage.set('Date To tidak boleh lebih kecil dari Date From.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.warningMessage.set('');
    this.clearSelection();
    this.page.set(1);
    this.api.getSchedules(this.buildFilters())
      .pipe(
        catchError((error: unknown) => {
          this.schedules.set([]);
          this.errorMessage.set(apiErrorMessage(error, 'Data report gagal dimuat.'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false))
      )
      .subscribe((schedules) => this.schedules.set(schedules));
  }

  resetFilters(): void {
    this.scheduleNo.set('');
    this.selectedCategoryId.set('');
    this.selectedLocCode.set('');
    this.dateFrom.set(this.defaultDateFrom());
    this.dateTo.set(this.today());
    this.search();
  }

  exportSelected(): void {
    const ids = [...this.selectedScheduleIds()];
    if (ids.length === 0) {
      this.errorMessage.set('Pilih minimal satu schedule yang akan diexport.');
      return;
    }

    this.exporting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.warningMessage.set('');
    forkJoin(ids.map((scheduleId) => this.api.getStockTakeReport(scheduleId, this.selectedCategoryId() || undefined)))
      .pipe(
        catchError((error: unknown) => {
          this.errorMessage.set(apiErrorMessage(error, 'Export report gagal diproses.'));
          return EMPTY;
        }),
        finalize(() => this.exporting.set(false))
      )
      .subscribe((reports) => {
        let exported = true;
        if (this.reportType() === 'ADDRESS') {
          this.exportAddressReports(reports);
        } else if (this.reportType() === 'VARIANCE') {
          this.exportVarianceReports(reports);
        } else if (this.reportType() === 'CATEGORY') {
          exported = this.printHtml(this.buildCategoryReportsHtml(reports));
        } else {
          exported = this.printHtml(this.buildTopBottomReportsHtml(reports));
        }
        if (exported) {
          this.successMessage.set(`${reports.length} schedule berhasil diproses untuk ${this.config().title}.`);
          const warnings = this.reportWarnings(reports);
          this.warningMessage.set(warnings.length ? warnings.join(' ') : '');
        }
      });
  }

  toggleSchedule(scheduleId: string, checked: boolean): void {
    const selected = new Set(this.selectedScheduleIds());
    if (checked) {
      selected.add(scheduleId);
    } else {
      selected.delete(scheduleId);
    }
    this.selectedScheduleIds.set(selected);
  }

  toggleVisibleSchedules(checked: boolean): void {
    const selected = new Set(this.selectedScheduleIds());
    for (const schedule of this.pagedSchedules()) {
      if (checked) {
        selected.add(schedule.id);
      } else {
        selected.delete(schedule.id);
      }
    }
    this.selectedScheduleIds.set(selected);
  }

  firstPage(): void {
    this.page.set(1);
  }

  previousPage(): void {
    this.page.update((page) => Math.max(1, page - 1));
  }

  nextPage(): void {
    this.page.update((page) => Math.min(this.totalPages(), page + 1));
  }

  lastPage(): void {
    this.page.set(this.totalPages());
  }

  statusLabel(status: string): string {
    return ({
      DRAFT: 'Draft',
      OPEN: 'Open',
      IN_PROGRESS: 'In progress',
      CLOSED: 'Closed',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled'
    } as Record<string, string>)[status] || status;
  }

  locationLabel(schedule: ActiveSchedule): string {
    return `${schedule.location.name} (${schedule.locCode})`;
  }

  categoryLabel(schedule: ActiveSchedule): string {
    if (schedule.stockType.name === 'ALL' || schedule.categories.length === 0) {
      return 'Semua category';
    }
    if (schedule.categories.length <= 2) {
      return schedule.categories.map((category) => category.name).join(', ');
    }
    return `${schedule.categories[0]?.name}, ${schedule.categories[1]?.name} +${schedule.categories.length - 2}`;
  }

  stockTypeLabel(schedule: ActiveSchedule): string {
    return schedule.stockType.name || schedule.stockType.code;
  }

  shortDate(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '-');
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  private buildFilters(): ScheduleQueryFilters {
    return {
      scheduleNo: this.scheduleNo().trim(),
      categoryId: this.selectedCategoryId(),
      locCode: this.selectedLocCode(),
      startDate: this.dateFrom(),
      endDate: this.dateTo()
    };
  }

  private clearSelection(): void {
    this.selectedScheduleIds.set(new Set());
  }

  private isDateRangeValid(): boolean {
    return !this.dateFrom() || !this.dateTo() || this.dateTo() >= this.dateFrom();
  }

  private exportAddressReports(reports: StockTakeReportBundle[]): void {
    const rows = reports.flatMap((report) => report.addressRows);
    this.downloadCsv(
      this.fileName('stock_take_address_report', 'csv'),
      ['Date', 'Branch', 'SKU Code', 'SKU Name', 'Address', 'Scanned Qty'],
      rows.map((row) => [
        row.date,
        row.branch,
        row.skuCode,
        row.skuName,
        row.address,
        this.decimal(row.scannedQty)
      ])
    );
  }

  private exportVarianceReports(reports: StockTakeReportBundle[]): void {
    const rows = reports.flatMap((report) => report.varianceRows);
    this.downloadCsv(
      this.fileName('stock_take_variance_report', 'csv'),
      [
        'Stock Take Request Number',
        'Stock Take Request Name',
        'Store',
        'Start Date',
        'End Date',
        'Stock Take Submission Date',
        'Stock Take Submission Type',
        'Status',
        'Division',
        'Department',
        'Category',
        'Article',
        'Item Barcode',
        'Article Description',
        'SOH Qty',
        'Qty Counted',
        'Stock Take Variance Qty',
        'Stock Take Variance Value',
        'Total Stock Take Variance Value by Category',
        'Grand Total'
      ],
      rows.map((row) => [
        row.stockTakeRequestNumber,
        row.stockTakeRequestName,
        row.store,
        row.startDate,
        row.endDate,
        row.stockTakeSubmissionDate,
        row.stockTakeSubmissionType,
        row.status,
        row.division,
        row.department,
        row.category,
        row.article,
        row.itemBarcode,
        row.articleDescription,
        this.decimal(row.sohQty),
        this.decimal(row.qtyCounted),
        this.decimal(row.stockTakeVarianceQty),
        this.decimal(row.stockTakeVarianceValue),
        this.decimal(row.totalStockTakeVarianceValueByCategory),
        this.decimal(row.grandTotal)
      ])
    );
  }

  private buildCategoryReportsHtml(reports: StockTakeReportBundle[]): string {
    const sections = reports.map((report) => this.categoryReportSection(report)).join('');
    return this.reportDocumentHtml('Stock Take Report by Category', sections);
  }

  private categoryReportSection(report: StockTakeReportBundle): string {
    const printedBy = this.auth.user()?.fullName || this.auth.user()?.username || '-';
    const total = report.categorySummaryRows.reduce((acc, row) => ({
      sohQty: acc.sohQty + row.sohQty,
      countedQty: acc.countedQty + row.countedQty,
      sohValue: acc.sohValue + row.sohValue,
      diffQty: acc.diffQty + row.diffQty,
      diffValue: acc.diffValue + row.diffValue
    }), { sohQty: 0, countedQty: 0, sohValue: 0, diffQty: 0, diffValue: 0 });
    const rows = report.categorySummaryRows.map((row) => `
      <tr>
        <td class="number">${row.no}</td>
        <td>${this.escapeHtml(this.shortDate(row.entryDate))}</td>
        <td>${this.escapeHtml(row.categoryCode)}</td>
        <td>${this.escapeHtml(row.categoryDescription)}</td>
        <td class="number">${this.integer(row.cost)}</td>
        <td class="number">${this.integer(row.sohQty)}</td>
        <td class="number">${this.integer(row.countedQty)}</td>
        <td class="number">${this.integer(row.sohValue)}</td>
        <td class="number">${this.integer(row.diffQty)}</td>
        <td class="number">${this.integer(row.diffValue)}</td>
      </tr>
    `).join('');

    return `
      <section class="report-section">
        <h1>${this.escapeHtml(report.schedule.locationName)}</h1>
        <h2>STOCKTAKE POSTING SUMMARY BY CATEGORY REPORT AS AT ${this.escapeHtml(this.shortDate(report.schedule.endDate))}</h2>
        ${this.printReadinessWarning(report)}
        <div class="print-meta">
          <div><span>Stock Take No.</span><strong>${this.escapeHtml(report.schedule.scheduleNo)}</strong></div>
          <div><span>Printed By</span><strong>${this.escapeHtml(printedBy)}</strong></div>
          <div><span>Stock Take Name</span><strong>${this.escapeHtml(report.schedule.scheduleDesc)}</strong></div>
          <div><span>Printed Date</span><strong>${this.escapeHtml(this.longDate(new Date()))}</strong></div>
          <div><span>Store</span><strong>${this.escapeHtml(report.schedule.locCode)} - ${this.escapeHtml(report.schedule.locationName)}</strong></div>
          <div><span>Printed Time</span><strong>${this.escapeHtml(this.time(new Date()))}</strong></div>
        </div>
        <table class="category-summary">
          <colgroup>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
          </colgroup>
          <thead>
            <tr>
              <th class="number">No</th>
              <th>Entry Date</th>
              <th>Category Code</th>
              <th>Category Description</th>
              <th class="number">Cost</th>
              <th class="number">SOH Qty</th>
              <th class="number">Counted Qty</th>
              <th class="number">SOH Value</th>
              <th class="number">Diff Qty</th>
              <th class="number">Diff Value</th>
            </tr>
          </thead>
          <tbody>${rows || this.emptyPrintRow(10)}</tbody>
          <tfoot>
            <tr>
              <td colspan="5">Total</td>
              <td class="number">${this.integer(total.sohQty)}</td>
              <td class="number">${this.integer(total.countedQty)}</td>
              <td class="number">${this.integer(total.sohValue)}</td>
              <td class="number">${this.integer(total.diffQty)}</td>
              <td class="number">${this.integer(total.diffValue)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    `;
  }

  private buildTopBottomReportsHtml(reports: StockTakeReportBundle[]): string {
    const sections = reports.map((report) => this.topBottomReportSection(report)).join('');
    return this.reportDocumentHtml('Top / Bottom 30', sections);
  }

  private topBottomReportSection(report: StockTakeReportBundle): string {
    const topPlus = this.topBottomRows(report, 'PLUS');
    const topMinus = this.topBottomRows(report, 'MINUS');
    return `
      <section class="report-section">
        <h1>Stock Take Variance By Location Report</h1>
        ${this.printReadinessWarning(report)}
        <div class="print-meta print-meta--wide">
          <div><span>Stock Take No.</span><strong>${this.escapeHtml(report.schedule.scheduleNo)}</strong></div>
          <div><span>Stock Take Description</span><strong>${this.escapeHtml(report.schedule.scheduleDesc)}</strong></div>
          <div><span>Store</span><strong>${this.escapeHtml(report.schedule.locCode)} - ${this.escapeHtml(report.schedule.locationName)}</strong></div>
          <div><span>Stock Take Type</span><strong>${this.escapeHtml(report.schedule.stockTypeName)}</strong></div>
          <div><span>Status</span><strong>${this.escapeHtml(report.schedule.status)}</strong></div>
          <div><span>Merchandise Hierarchy</span><strong>${this.escapeHtml(this.selectedCategoryText())}</strong></div>
        </div>
        ${this.topBottomTable('Top 30 Plus', topPlus)}
        ${this.topBottomTable('Top 30 Minus', topMinus)}
      </section>
    `;
  }

  private topBottomRows(report: StockTakeReportBundle, direction: 'PLUS' | 'MINUS'): TopBottomRow[] {
    return report.varianceRows
      .filter((row) => direction === 'PLUS' ? row.stockTakeVarianceQty > 0 : row.stockTakeVarianceQty < 0)
      .sort((left, right) =>
        direction === 'PLUS'
          ? right.stockTakeVarianceQty - left.stockTakeVarianceQty
          : left.stockTakeVarianceQty - right.stockTakeVarianceQty
      )
      .slice(0, 30)
      .map((row, index) => ({
        no: index + 1,
        stockTakeRequestNumber: row.stockTakeRequestNumber,
        store: row.store,
        category: row.category,
        article: row.article,
        itemBarcode: row.itemBarcode,
        articleDescription: row.articleDescription,
        sohQty: row.sohQty,
        qtyCounted: row.qtyCounted,
        diffQty: row.stockTakeVarianceQty,
        diffValue: row.stockTakeVarianceValue
      }));
  }

  private topBottomTable(title: string, rows: TopBottomRow[]): string {
    const body = rows.map((row) => `
      <tr>
        <td class="number">${row.no}</td>
        <td>${this.escapeHtml(row.category)}</td>
        <td><strong>${this.escapeHtml(row.article)}</strong><br>${this.escapeHtml(row.articleDescription)}</td>
        <td>${this.escapeHtml(row.itemBarcode)}</td>
        <td class="number">${this.integer(row.sohQty)}</td>
        <td class="number">${this.integer(row.qtyCounted)}</td>
        <td class="number">${this.integer(row.diffQty)}</td>
        <td class="number">${this.integer(row.diffValue)}</td>
      </tr>
    `).join('');
    return `
      <h3>${this.escapeHtml(title)}</h3>
      <table>
        <thead>
          <tr>
            <th class="number">S/N</th>
            <th>Category</th>
            <th>Product No. / Product UPC</th>
            <th>Item Barcode</th>
            <th class="number">SOH Qty</th>
            <th class="number">Counted Qty</th>
            <th class="number">Diff Qty</th>
            <th class="number">Diff Value</th>
          </tr>
        </thead>
        <tbody>${body || this.emptyPrintRow(8)}</tbody>
      </table>
    `;
  }

  private downloadCsv(fileName: string, headers: string[], rows: Array<Array<string | number>>): void {
    const content = [headers, ...rows]
      .map((row) => row.map((cell) => this.csvCell(cell)).join(','))
      .join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private printHtml(html: string): boolean {
    const popup = window.open('', '_blank', 'width=860,height=1120');
    if (!popup) {
      this.errorMessage.set('Popup browser diblokir. Izinkan popup untuk mencetak report.');
      return false;
    }
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
    return true;
  }

  private reportDocumentHtml(title: string, body: string): string {
    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${this.escapeHtml(title)}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; color: #000; font-family: Arial, sans-serif; font-size: 8.5px; }
            main { width: 100%; padding: 0; }
            h1 { margin: 0 0 5px; font-size: 13px; text-transform: uppercase; }
            h2 { margin: 0 0 9px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; }
            h3 { margin: 16px 0 7px; font-size: 10.5px; text-transform: uppercase; }
            .report-section { break-after: page; page-break-after: always; }
            .report-section:last-child { break-after: auto; page-break-after: auto; }
            .print-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; margin: 9px 0 11px; }
            .print-meta--wide { grid-template-columns: 1fr 1fr; }
            .print-meta div { display: grid; grid-template-columns: 88px 1fr; gap: 6px; }
            .print-meta span { font-weight: 700; }
            .print-meta strong { font-weight: 400; }
            .print-warning { margin: 8px 0 10px; border: 1px solid #000; padding: 6px 8px; font-weight: 700; }
            .print-warning ul { margin: 4px 0 0 15px; padding: 0; font-weight: 400; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
            th, td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; overflow-wrap: anywhere; }
            th { font-weight: 700; text-align: left; }
            tfoot td { font-weight: 700; }
            .number { text-align: right; white-space: nowrap; }
            .category-summary col:nth-child(1) { width: 4%; }
            .category-summary col:nth-child(2) { width: 8%; }
            .category-summary col:nth-child(3) { width: 8%; }
            .category-summary col:nth-child(4) { width: 19%; }
            .category-summary col:nth-child(5) { width: 9%; }
            .category-summary col:nth-child(6) { width: 9%; }
            .category-summary col:nth-child(7) { width: 10%; }
            .category-summary col:nth-child(8) { width: 12%; }
            .category-summary col:nth-child(9) { width: 9%; }
            .category-summary col:nth-child(10) { width: 12%; }
            @page { size: A4; margin: 8mm; }
          </style>
        </head>
        <body><main>${body}</main></body>
      </html>`;
  }

  private emptyPrintRow(colspan: number): string {
    return `<tr><td colspan="${colspan}">Tidak ada data.</td></tr>`;
  }

  private reportWarnings(reports: StockTakeReportBundle[]): string[] {
    const messages = reports.flatMap((report) =>
      report.readiness.warnings.map((warning) => `${report.schedule.scheduleNo}: ${warning}`)
    );
    return [...new Set(messages)];
  }

  private printReadinessWarning(report: StockTakeReportBundle): string {
    if (!report.readiness.warnings.length) return '';
    const items = report.readiness.warnings
      .map((warning) => `<li>${this.escapeHtml(warning)}</li>`)
      .join('');
    return `
      <div class="print-warning">
        Perhatian: data report perlu dicek
        <ul>${items}</ul>
      </div>
    `;
  }

  private selectedCategoryText(): string {
    const category = this.selectedCategory();
    return category ? `${category.id} - ${category.name}` : 'Semua category';
  }

  private fileName(prefix: string, extension: string): string {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    return `${prefix}_${stamp}.${extension}`;
  }

  private today(): string {
    return this.dateInputValue(new Date());
  }

  private defaultDateFrom(): string {
    const date = new Date();
    date.setDate(date.getDate() - 90);
    return this.dateInputValue(date);
  }

  private dateInputValue(date: Date): string {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 10);
  }

  private decimal(value: number): string {
    return (Number.isFinite(value) ? value : 0).toFixed(3);
  }

  private integer(value: number): string {
    return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('id-ID');
  }

  private longDate(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '-');
    return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(date);
  }

  private time(value: Date): string {
    return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
  }

  private csvCell(value: string | number): string {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[character] ?? character);
  }
}
