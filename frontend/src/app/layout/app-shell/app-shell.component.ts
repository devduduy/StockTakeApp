import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

interface NavigationItem {
  label: string;
  icon: string;
  route?: string;
  hint?: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent {
  readonly mobileMenuOpen = signal(false);
  readonly navigation: NavigationItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Schedule', icon: 'event_note', route: '/schedules' },
    { label: 'Monitoring Rack', icon: 'grid_view', route: '/schedules', hint: 'Pilih schedule' },
    { label: 'Data Scan', icon: 'barcode_scanner', hint: 'Tahap berikutnya' },
    { label: 'Rekonsiliasi', icon: 'difference', hint: 'Tahap berikutnya' },
    { label: 'Laporan & Print', icon: 'print', hint: 'Tahap berikutnya' }
  ];

  constructor(readonly auth: AuthService) {}

  toggleMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  closeMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
