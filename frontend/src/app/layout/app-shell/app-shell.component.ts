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
  readonly desktopMenuCollapsed = signal(localStorage.getItem('hero-web-menu-collapsed') === 'true');
  readonly navigation: NavigationItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Schedule', icon: 'event_note', route: '/schedules' },
    { label: 'Schedule Close', icon: 'event_available', route: '/closed-schedules' },
    { label: 'Master Rack', icon: 'inventory_2', route: '/master-racks' },
    { label: 'Manage User', icon: 'manage_accounts', route: '/users' },
    { label: 'Monitoring Rack', icon: 'grid_view', route: '/schedules', hint: 'Pilih schedule' },
    { label: 'Data Scan', icon: 'barcode_scanner', hint: 'Tahap berikutnya' },
    { label: 'Rekonsiliasi', icon: 'difference', hint: 'Tahap berikutnya' },
    { label: 'Laporan & Print', icon: 'print', hint: 'Tahap berikutnya' }
  ];

  constructor(readonly auth: AuthService) {}

  toggleMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  toggleDesktopMenu(): void {
    this.desktopMenuCollapsed.update((collapsed) => {
      const nextValue = !collapsed;
      localStorage.setItem('hero-web-menu-collapsed', String(nextValue));
      return nextValue;
    });
  }

  closeMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
