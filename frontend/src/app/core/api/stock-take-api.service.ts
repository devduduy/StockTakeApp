import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import {
  ActiveSchedule,
  ApiEnvelope,
  DashboardSnapshot,
  RackListResponse,
  RackScanListResponse
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class StockTakeApiService {
  constructor(private readonly http: HttpClient) {}

  getActiveSchedules(): Observable<ActiveSchedule[]> {
    return this.http
      .get<ApiEnvelope<ActiveSchedule[]>>('/api/stock-take/schedules/active')
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
