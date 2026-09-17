import { Component, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

interface NavigationItem {
  label: string;
  icon: string;
  route?: string;
  hint?: string;
  children?: Array<{
    label: string;
    route: string;
  }>;
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
  readonly expandedNavigationGroups = signal<Set<string>>(new Set(['Reporting']));
  readonly navigation: NavigationItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Schedule', icon: 'event_note', route: '/schedules' },
    { label: 'Schedule Close', icon: 'event_available', route: '/closed-schedules' },
    { label: 'Master Rack', icon: 'inventory_2', route: '/master-racks' },
    { label: 'Master SOH', icon: 'database', route: '/master-soh' },
    { label: 'Manage User', icon: 'manage_accounts', route: '/users' },
    {
      label: 'Reporting',
      icon: 'print',
      route: '/reports/address',
      children: [
        { label: 'Stock Take Schedule Report', route: '/reports/address' },
        { label: 'Stock Take Report by Category', route: '/reports/category' },
        { label: 'Stock Take Variance Report', route: '/reports/variance' },
        { label: 'Top / Bottom 30', route: '/reports/top-bottom-30' }
      ]
    }
  ];

  constructor(readonly auth: AuthService, private readonly router: Router) {}

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

  isNavigationGroupActive(item: NavigationItem): boolean {
    return item.children?.some((child) => this.router.url.startsWith(child.route)) ?? false;
  }

  isNavigationGroupExpanded(item: NavigationItem): boolean {
    return this.expandedNavigationGroups().has(item.label);
  }

  toggleNavigationGroup(item: NavigationItem): void {
    this.expandedNavigationGroups.update((groups) => {
      const nextGroups = new Set(groups);
      if (nextGroups.has(item.label)) {
        nextGroups.delete(item.label);
      } else {
        nextGroups.add(item.label);
      }
      return nextGroups;
    });
  }
}
