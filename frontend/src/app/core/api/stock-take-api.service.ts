import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import {
  ActiveSchedule,
  ApiEnvelope,
  Category,
  DashboardSnapshot,
  Location,
  ManagedUser,
  ManagedUserPayload,
  PageResponse,
  PrintRackResponse,
  RackBulkCreatePayload,
  RackCreatePayload,
  RackFinalQtyPayload,
  RackListResponse,
  RackMaster,
  RackScanListResponse,
  ScheduleRackScopeResponse,
  SchedulePayload,
  RoleOption,
  ItemSearchResult,
  ScheduleUser,
  SohGenerateResponse,
  SohScheduleSummary,
  StockTakeReportBundle,
  UserImportResult,
  UserImportRow,
  UserOption,
  RackScan
} from '../models/api.models';

export interface ScheduleQueryFilters {
  scheduleNo?: string;
  locCode?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  stockType?: string;
}

@Injectable({ providedIn: 'root' })
export class StockTakeApiService {
  constructor(private readonly http: HttpClient) {}

  getActiveSchedules(): Observable<ActiveSchedule[]> {
    return this.http
      .get<ApiEnvelope<ActiveSchedule[]>>('/api/stock-take/schedules/active')
      .pipe(map(({ data }) => data));
  }

  getSchedules(filters?: ScheduleQueryFilters): Observable<ActiveSchedule[]> {
    const params = Object.fromEntries(
      Object.entries(filters ?? {}).filter(([, value]) => Boolean(value))
    ) as Record<string, string>;
    return this.http
      .get<ApiEnvelope<ActiveSchedule[]>>('/api/stock-take/schedules', { params })
      .pipe(map(({ data }) => data));
  }

  getSchedulesPage(filters: ScheduleQueryFilters | undefined, page: number, pageSize: number): Observable<PageResponse<ActiveSchedule>> {
    const params = Object.fromEntries(
      Object.entries({ ...(filters ?? {}), page: String(page), pageSize: String(pageSize) })
        .filter(([, value]) => Boolean(value))
    ) as Record<string, string>;
    return this.http
      .get<ApiEnvelope<PageResponse<ActiveSchedule>>>('/api/stock-take/schedules/page', { params })
      .pipe(map(({ data }) => data));
  }

  closeSchedule(scheduleId: string): Observable<ActiveSchedule> {
    return this.http
      .post<ApiEnvelope<ActiveSchedule>>(`/api/stock-take/schedules/${scheduleId}/close`, {})
      .pipe(map(({ data }) => data));
  }

  createSchedule(payload: SchedulePayload): Observable<ActiveSchedule> {
    return this.http
      .post<ApiEnvelope<ActiveSchedule>>('/api/stock-take/schedules', payload)
      .pipe(map(({ data }) => data));
  }

  updateSchedule(scheduleId: string, payload: SchedulePayload): Observable<ActiveSchedule> {
    return this.http
      .put<ApiEnvelope<ActiveSchedule>>(`/api/stock-take/schedules/${scheduleId}`, payload)
      .pipe(map(({ data }) => data));
  }

  getScheduleUsers(scheduleId: string): Observable<ScheduleUser[]> {
    return this.http
      .get<ApiEnvelope<ScheduleUser[]>>(`/api/stock-take/schedules/${scheduleId}/users`)
      .pipe(map(({ data }) => data));
  }

  getScheduleUserCandidates(scheduleId: string): Observable<ScheduleUser[]> {
    return this.http
      .get<ApiEnvelope<ScheduleUser[]>>(`/api/stock-take/schedules/${scheduleId}/user-candidates`)
      .pipe(map(({ data }) => data));
  }

  updateScheduleUsers(scheduleId: string, userIds: string[]): Observable<ScheduleUser[]> {
    return this.http
      .put<ApiEnvelope<ScheduleUser[]>>(`/api/stock-take/schedules/${scheduleId}/users`, { userIds })
      .pipe(map(({ data }) => data));
  }

  getCategories(): Observable<Category[]> {
    return this.http
      .get<ApiEnvelope<Category[]>>('/api/stock-take/categories')
      .pipe(map(({ data }) => data));
  }

  getLocations(): Observable<Location[]> {
    return this.http
      .get<ApiEnvelope<Location[]>>('/api/stock-take/locations')
      .pipe(map(({ data }) => data));
  }

  getRoles(): Observable<RoleOption[]> {
    return this.http
      .get<ApiEnvelope<RoleOption[]>>('/api/stock-take/users/roles')
      .pipe(map(({ data }) => data));
  }

  getUsers(): Observable<ManagedUser[]> {
    return this.http
      .get<ApiEnvelope<ManagedUser[]>>('/api/stock-take/users')
      .pipe(map(({ data }) => data));
  }

  createUser(payload: ManagedUserPayload): Observable<ManagedUser> {
    return this.http
      .post<ApiEnvelope<ManagedUser>>('/api/stock-take/users', payload)
      .pipe(map(({ data }) => data));
  }

  updateUser(userId: string, payload: ManagedUserPayload): Observable<ManagedUser> {
    return this.http
      .put<ApiEnvelope<ManagedUser>>(`/api/stock-take/users/${userId}`, payload)
      .pipe(map(({ data }) => data));
  }

  importUsers(rows: UserImportRow[]): Observable<UserImportResult> {
    return this.http
      .post<ApiEnvelope<UserImportResult>>('/api/stock-take/users/import', { rows })
      .pipe(map(({ data }) => data));
  }

  getRackMasters(locCode?: string): Observable<RackMaster[]> {
    const options = locCode ? { params: { locCode } } : undefined;
    return this.http
      .get<ApiEnvelope<RackMaster[]>>('/api/stock-take/racks', options)
      .pipe(map(({ data }) => data));
  }

  createRack(payload: RackCreatePayload): Observable<RackMaster> {
    return this.http
      .post<ApiEnvelope<RackMaster>>('/api/stock-take/racks', payload)
      .pipe(map(({ data }) => data));
  }

  createRacksBulk(payload: RackBulkCreatePayload): Observable<RackMaster[]> {
    return this.http
      .post<ApiEnvelope<RackMaster[]>>('/api/stock-take/racks/bulk', payload)
      .pipe(map(({ data }) => data));
  }

  updateRack(rackId: string, payload: Pick<RackCreatePayload, 'rackCode' | 'rackName' | 'status'>): Observable<RackMaster> {
    return this.http
      .put<ApiEnvelope<RackMaster>>(`/api/stock-take/racks/${rackId}`, payload)
      .pipe(map(({ data }) => data));
  }

  deleteRack(rackId: string): Observable<void> {
    return this.http.delete<void>(`/api/stock-take/racks/${rackId}`);
  }

  addRackToSchedule(scheduleId: string, rackId: string): Observable<ScheduleRackScopeResponse> {
    return this.http
      .post<ApiEnvelope<ScheduleRackScopeResponse>>(`/api/stock-take/schedules/${scheduleId}/racks/scope`, { rackId })
      .pipe(map(({ data }) => data));
  }

  getRecheckers(): Observable<UserOption[]> {
    return this.http
      .get<ApiEnvelope<UserOption[]>>('/api/auth/recheckers')
      .pipe(map(({ data }) => data));
  }

  getRacks(scheduleId: string): Observable<RackListResponse> {
    return this.http
      .get<ApiEnvelope<RackListResponse>>(`/api/stock-take/schedules/${scheduleId}/racks`)
      .pipe(map(({ data }) => data));
  }

  getRackScans(scheduleId: string, rackId: string): Observable<RackScanListResponse> {
    return this.http
      .get<ApiEnvelope<RackScanListResponse>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans`
      )
      .pipe(map(({ data }) => data));
  }

  printRack(scheduleId: string, rackId: string): Observable<PrintRackResponse> {
    return this.http
      .post<ApiEnvelope<PrintRackResponse>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/print`,
        {}
      )
      .pipe(map(({ data }) => data));
  }

  updateRackFinalQty(scheduleId: string, rackId: string, payload: RackFinalQtyPayload): Observable<RackScanListResponse> {
    return this.http
      .patch<ApiEnvelope<RackScanListResponse>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/final-qty`,
        payload
      )
      .pipe(map(({ data }) => data));
  }

  confirmRack(scheduleId: string, rackId: string, payload: RackFinalQtyPayload): Observable<RackScanListResponse> {
    return this.http
      .post<ApiEnvelope<RackScanListResponse>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/confirm`,
        payload
      )
      .pipe(map(({ data }) => data));
  }

  rejectRack(scheduleId: string, rackId: string): Observable<{ rejected: boolean }> {
    return this.http
      .post<ApiEnvelope<{ rejected: boolean }>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/reject`,
        {}
      )
      .pipe(map(({ data }) => data));
  }

  getDashboardSnapshot(): Observable<DashboardSnapshot> {
    return this.getActiveSchedules().pipe(
      switchMap((schedules) => {
        if (schedules.length === 0) {
          return of({
            schedules,
            scheduleProgress: [],
            totalRacks: 0,
            emptyRacks: 0,
            submittedRacks: 0,
            printedRacks: 0,
            waitingConfirmRacks: 0,
            confirmedRacks: 0,
            rejectedRacks: 0,
            discrepancyRacks: 0,
            schedulesWithSoh: 0,
            schedulesWithoutSoh: 0,
            totalLines: 0,
            totalQuantity: 0,
            finalQuantity: 0,
            discrepancyQuantity: 0
          });
        }
        return forkJoin(
          schedules.map((schedule) =>
            forkJoin({
              racks: this.getRacks(schedule.id),
              soh: this.getSohSummary(schedule.id).pipe(catchError(() => of(null)))
            }).pipe(
              map(({ racks, soh }) => {
                const totalRacks = racks.racks.length;
                const emptyRacks = racks.racks.filter((rack) => rack.rackStatus === 'EMPTY').length;
                const submittedRacks = racks.racks.filter((rack) => rack.submittedLineCount > 0).length;
                const printedRacks = racks.racks.filter((rack) => rack.printedLineCount > 0).length;
                const confirmedRacks = racks.racks.filter((rack) => rack.rackStatus === 'CONFIRMED').length;
                const rejectedRacks = racks.racks.filter((rack) => rack.rackStatus === 'REJECTED').length;
                const waitingConfirmRacks = racks.racks.filter((rack) =>
                  rack.printedLineCount > 0 && !['CONFIRMED', 'REJECTED'].includes(rack.rackStatus)
                ).length;
                const discrepancyRacks = racks.racks.filter((rack) => rack.discrepancyQuantity !== 0).length;
                const totalLines = racks.racks.reduce((sum, rack) => sum + rack.submittedLineCount, 0);
                const totalQuantity = racks.racks.reduce((sum, rack) => sum + rack.submittedQuantity, 0);
                const finalQuantity = racks.racks.reduce((sum, rack) => sum + rack.finalQuantity, 0);
                const discrepancyQuantity = racks.racks.reduce((sum, rack) => sum + rack.discrepancyQuantity, 0);
                return {
                  schedule,
                  sohReady: (soh?.sohRowCount ?? 0) > 0,
                  sohRowCount: soh?.sohRowCount ?? 0,
                  totalRacks,
                  emptyRacks,
                  submittedRacks,
                  printedRacks,
                  waitingConfirmRacks,
                  confirmedRacks,
                  rejectedRacks,
                  discrepancyRacks,
                  totalLines,
                  totalQuantity,
                  finalQuantity,
                  discrepancyQuantity,
                  scanProgress: totalRacks === 0 ? 0 : Math.round((submittedRacks / totalRacks) * 100),
                  confirmProgress: totalRacks === 0 ? 0 : Math.round((confirmedRacks / totalRacks) * 100)
                };
              })
            )
          )
        ).pipe(
          map((scheduleProgress) => ({
            schedules,
            scheduleProgress,
            totalRacks: scheduleProgress.reduce((sum, item) => sum + item.totalRacks, 0),
            emptyRacks: scheduleProgress.reduce((sum, item) => sum + item.emptyRacks, 0),
            submittedRacks: scheduleProgress.reduce((sum, item) => sum + item.submittedRacks, 0),
            printedRacks: scheduleProgress.reduce((sum, item) => sum + item.printedRacks, 0),
            waitingConfirmRacks: scheduleProgress.reduce((sum, item) => sum + item.waitingConfirmRacks, 0),
            confirmedRacks: scheduleProgress.reduce((sum, item) => sum + item.confirmedRacks, 0),
            rejectedRacks: scheduleProgress.reduce((sum, item) => sum + item.rejectedRacks, 0),
            discrepancyRacks: scheduleProgress.reduce((sum, item) => sum + item.discrepancyRacks, 0),
            schedulesWithSoh: scheduleProgress.filter((item) => item.sohReady).length,
            schedulesWithoutSoh: scheduleProgress.filter((item) => !item.sohReady).length,
            totalLines: scheduleProgress.reduce((sum, item) => sum + item.totalLines, 0),
            totalQuantity: scheduleProgress.reduce((sum, item) => sum + item.totalQuantity, 0),
            finalQuantity: scheduleProgress.reduce((sum, item) => sum + item.finalQuantity, 0),
            discrepancyQuantity: scheduleProgress.reduce((sum, item) => sum + item.discrepancyQuantity, 0)
          }))
        );
      })
    );
  }

  addManualRackScan(scheduleId: string, rackId: string, barcode: string, qty: number): Observable<{ scans: RackScan[] }> {
    return this.http
      .post<ApiEnvelope<{ scans: RackScan[] }>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/manual`,
        { barcode, qty }
      )
      .pipe(map(({ data }) => data));
  }

  deleteRackScan(scheduleId: string, rackId: string, scanId: string): Observable<{ scans: RackScan[] }> {
    return this.http
      .delete<ApiEnvelope<{ scans: RackScan[] }>>(
        `/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/${scanId}`
      )
      .pipe(map(({ data }) => data));
  }

  searchItems(keyword: string, scheduleId?: string): Observable<ItemSearchResult[]> {
    const params: Record<string, string> = { q: keyword };
    if (scheduleId) params['scheduleId'] = scheduleId;
    return this.http
      .get<ApiEnvelope<ItemSearchResult[]>>('/api/stock-take/items/search', { params })
      .pipe(map(({ data }) => data));
  }

  getStockTakeReport(scheduleId: string, categoryId?: string, section?: string): Observable<StockTakeReportBundle> {
    const params: Record<string, string> = {};
    if (categoryId) params['categoryId'] = categoryId;
    if (section) params['section'] = section;
    return this.http
      .get<ApiEnvelope<StockTakeReportBundle>>(`/api/stock-take/reports/${scheduleId}`, {
        params: Object.keys(params).length ? params : undefined
      })
      .pipe(map(({ data }) => data));
  }

  exportStockTakeReportCsv(
    type: 'ADDRESS' | 'VARIANCE',
    scheduleIds: string[],
    categoryId?: string
  ): Observable<HttpResponse<Blob>> {
    const params: Record<string, string> = {
      type,
      scheduleIds: scheduleIds.join(',')
    };
    if (categoryId) params['categoryId'] = categoryId;
    return this.http.get('/api/stock-take/reports/export/csv', {
      params,
      observe: 'response',
      responseType: 'blob'
    });
  }

  getSohSummary(scheduleId: string): Observable<SohScheduleSummary> {
    return this.http
      .get<ApiEnvelope<SohScheduleSummary>>(`/api/stock-take/soh/${scheduleId}`)
      .pipe(map(({ data }) => data));
  }

  generateSoh(scheduleId: string): Observable<SohGenerateResponse> {
    return this.http
      .post<ApiEnvelope<SohGenerateResponse>>(`/api/stock-take/soh/${scheduleId}/generate`, {})
      .pipe(map(({ data }) => data));
  }
}
