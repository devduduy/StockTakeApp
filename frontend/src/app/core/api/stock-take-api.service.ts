import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import {
  ActiveSchedule,
  ApiEnvelope,
  Category,
  DashboardSnapshot,
  Location,
  PrintRackResponse,
  RackBulkCreatePayload,
  RackCreatePayload,
  RackFinalQtyPayload,
  RackListResponse,
  RackMaster,
  RackScanListResponse,
  ScheduleRackScopeResponse,
  SchedulePayload,
  UserOption
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class StockTakeApiService {
  constructor(private readonly http: HttpClient) {}

  getActiveSchedules(): Observable<ActiveSchedule[]> {
    return this.http
      .get<ApiEnvelope<ActiveSchedule[]>>('/api/stock-take/schedules/active')
      .pipe(map(({ data }) => data));
  }

  getSchedules(): Observable<ActiveSchedule[]> {
    return this.http
      .get<ApiEnvelope<ActiveSchedule[]>>('/api/stock-take/schedules')
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
          return of({ schedules, totalRacks: 0, submittedRacks: 0, totalLines: 0, totalQuantity: 0 });
        }
        return forkJoin(schedules.map((schedule) => this.getRacks(schedule.id))).pipe(
          map((responses) => ({
            schedules,
            totalRacks: responses.reduce((sum, response) => sum + response.racks.length, 0),
            submittedRacks: responses.reduce(
              (sum, response) => sum + response.racks.filter((rack) => rack.submittedLineCount > 0).length,
              0
            ),
            totalLines: responses.reduce(
              (sum, response) => sum + response.racks.reduce((rackSum, rack) => rackSum + rack.submittedLineCount, 0),
              0
            ),
            totalQuantity: responses.reduce(
              (sum, response) => sum + response.racks.reduce((rackSum, rack) => rackSum + rack.submittedQuantity, 0),
              0
            )
          }))
        );
      })
    );
  }
}
