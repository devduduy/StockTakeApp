import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then((component) => component.LoginComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/app-shell/app-shell.component').then((component) => component.AppShellComponent),
    children: [
      {
        path: 'dashboard',
        title: 'Dashboard | Hero Stock Take',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((component) => component.DashboardComponent)
      },
      {
        path: 'schedules',
        title: 'Schedule | Hero Stock Take',
        loadComponent: () =>
          import('./features/schedules/schedule-list.component').then((component) => component.ScheduleListComponent)
      },
      {
        path: 'closed-schedules',
        title: 'Schedule Close | Hero Stock Take',
        loadComponent: () =>
          import('./features/closed-schedules/closed-schedule-list.component').then((component) => component.ClosedScheduleListComponent)
      },
      {
        path: 'master-racks',
        title: 'Master Rack | Hero Stock Take',
        loadComponent: () =>
          import('./features/master-racks/master-rack.component').then((component) => component.MasterRackComponent)
      },
      {
        path: 'master-soh',
        title: 'Master SOH | Hero Stock Take',
        loadComponent: () =>
          import('./features/master-soh/master-soh.component').then((component) => component.MasterSohComponent)
      },
      {
        path: 'users',
        title: 'Manage User | Hero Stock Take',
        loadComponent: () =>
          import('./features/users/user-management.component').then((component) => component.UserManagementComponent)
      },
      {
        path: 'reports',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'address' },
          {
            path: 'address',
            title: 'Stock Take Report By Address | Hero Stock Take',
            data: { reportType: 'ADDRESS' },
            loadComponent: () =>
              import('./features/reports/report-list.component').then((component) => component.ReportListComponent)
          },
          {
            path: 'category',
            title: 'Stock Take Report by Category | Hero Stock Take',
            data: { reportType: 'CATEGORY' },
            loadComponent: () =>
              import('./features/reports/report-list.component').then((component) => component.ReportListComponent)
          },
          {
            path: 'variance',
            title: 'Stock Take Variance Report | Hero Stock Take',
            data: { reportType: 'VARIANCE' },
            loadComponent: () =>
              import('./features/reports/report-list.component').then((component) => component.ReportListComponent)
          },
          {
            path: 'top-bottom-30',
            title: 'Top / Bottom 30 | Hero Stock Take',
            data: { reportType: 'TOP_BOTTOM' },
            loadComponent: () =>
              import('./features/reports/report-list.component').then((component) => component.ReportListComponent)
          }
        ]
      },
      {
        path: 'schedules/:scheduleId/racks',
        title: 'Monitoring Rack | Hero Stock Take',
        loadComponent: () =>
          import('./features/racks/rack-monitoring.component').then((component) => component.RackMonitoringComponent)
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' }
    ]
  },
  { path: '**', redirectTo: '' }
];
