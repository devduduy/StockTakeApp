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
