package com.hero.stocktake.ui;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.GravityCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.fragment.app.Fragment;

import com.hero.stocktake.R;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.domain.model.Schedule;
import com.hero.stocktake.ui.dashboard.DashboardFragment;
import com.hero.stocktake.ui.login.LoginActivity;
import com.hero.stocktake.ui.profile.ProfileFragment;
import com.hero.stocktake.ui.rack.RackListFragment;
import com.hero.stocktake.ui.scanner.ScannerFragment;
import com.hero.stocktake.ui.schedule.ScheduleListFragment;
import com.hero.stocktake.ui.submit.SubmissionSuccessFragment;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;

public class MainActivity extends AppCompatActivity {
    private DrawerLayout drawerLayout;
    private View menuDashboard;
    private View menuSchedules;
    private View menuScanner;
    private View menuProfile;
    private ImageButton menuButton;
    private TextView toolbarTitle;
    private String activeScheduleId;
    private String activeRackId;
    private String activeRackCode;
    private boolean activeRackSubmitted;
    private boolean activeRackPrinted;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.mainRoot), (view, insets) -> {
            Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            view.setPadding(view.getPaddingLeft(), statusBars.top, view.getPaddingRight(), view.getPaddingBottom());
            return insets;
        });

        drawerLayout = findViewById(R.id.mainRoot);
        toolbarTitle = findViewById(R.id.toolbarTitle);
        menuButton = findViewById(R.id.menuButton);
        menuDashboard = findViewById(R.id.menuDashboard);
        menuSchedules = findViewById(R.id.menuSchedules);
        menuScanner = findViewById(R.id.menuScanner);
        menuProfile = findViewById(R.id.menuProfile);

        menuDashboard.setOnClickListener(view -> showTopLevel(new DashboardFragment(), menuDashboard, "Dashboard"));
        menuSchedules.setOnClickListener(view -> openSchedules());
        menuScanner.setOnClickListener(view -> openScanner());
        menuProfile.setOnClickListener(view -> showTopLevel(new ProfileFragment(), menuProfile, "Profile"));

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
                    drawerLayout.closeDrawer(GravityCompat.START);
                } else if (getSupportFragmentManager().getBackStackEntryCount() > 0) {
                    getSupportFragmentManager().popBackStack();
                    if (getSupportFragmentManager().getBackStackEntryCount() <= 1) {
                        setBottomNavigationVisible(true);
                    }
                } else {
                    finish();
                }
            }
        });

        if (savedInstanceState == null) {
            showTopLevel(new DashboardFragment(), menuDashboard, "Dashboard");
        }
    }

    private void showTopLevel(Fragment fragment, View activeMenu, String title) {
        getSupportFragmentManager().popBackStack(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE);
        setActiveMenu(activeMenu, title);
        setToolbarNavigation(false);
        drawerLayout.closeDrawer(GravityCompat.START);
        getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .commit();
    }

    private void showDetail(Fragment fragment, View activeMenu, String title) {
        setActiveMenu(activeMenu, title);
        setToolbarNavigation(true);
        drawerLayout.closeDrawer(GravityCompat.START);
        getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .addToBackStack(fragment.getClass().getSimpleName())
                .commit();
    }

    public void openSchedules() {
        showTopLevel(new ScheduleListFragment(), menuSchedules, "Schedule Aktif");
    }

    public void openRackList() {
        if (activeScheduleId == null) {
            Toast.makeText(this, "Pilih active schedule dulu.", Toast.LENGTH_SHORT).show();
            openSchedules();
            return;
        }
        showDetail(RackListFragment.newInstance(activeScheduleId, "Stock Take", ""), menuSchedules, "Rack List");
    }

    public void openRackList(Schedule schedule) {
        if (!isSchedulePeriodOpen(schedule)) {
            Toast.makeText(
                    this,
                    "Stock take hanya bisa dimulai pada periode " + schedule.scheduleDate() + ".",
                    Toast.LENGTH_LONG
            ).show();
            return;
        }
        activeScheduleId = schedule.id();
        activeRackId = null;
        activeRackCode = null;
        activeRackSubmitted = false;
        activeRackPrinted = false;
        showDetail(RackListFragment.newInstance(schedule.id(), schedule.stockType(), schedule.number()), menuSchedules, "Rack List");
    }

    private boolean isSchedulePeriodOpen(Schedule schedule) {
        try {
            LocalDate today = LocalDate.now();
            LocalDate startDate = LocalDate.parse(schedule.startDate());
            LocalDate endDate = LocalDate.parse(schedule.endDate());
            return !today.isBefore(startDate) && !today.isAfter(endDate);
        } catch (DateTimeParseException | NullPointerException ignored) {
            return true;
        }
    }

    public void openRackDetail() {
        openScanner();
    }

    public void openRackDetail(Rack rack) {
        activeRackId = rack.id();
        activeRackCode = rack.code();
        activeRackSubmitted = rack.submitted();
        activeRackPrinted = rack.printed();
        openScanner();
    }

    public void openScanner(Rack rack) {
        activeRackId = rack.id();
        activeRackCode = rack.code();
        activeRackSubmitted = rack.submitted();
        activeRackPrinted = rack.printed();
        openScanner();
    }

    public void openScanner() {
        if (activeScheduleId == null || activeRackId == null) {
            Toast.makeText(this, "Pilih rack dulu sebelum scan.", Toast.LENGTH_SHORT).show();
            openSchedules();
            return;
        }
        String scannerTitle = activeRackCode == null || activeRackCode.trim().isEmpty() ? activeRackId : activeRackCode;
        showDetail(ScannerFragment.newInstance(activeScheduleId, activeRackId, scannerTitle, activeRackSubmitted, activeRackPrinted), menuScanner, scannerTitle);
    }

    public void showSubmissionSuccess(int submittedLines) {
        showDetail(SubmissionSuccessFragment.newInstance(submittedLines), menuScanner, "Submit Success");
    }

    public void markActiveRackSubmitted() {
        activeRackSubmitted = true;
    }

    public void markActiveRackPrinted() {
        activeRackSubmitted = true;
        activeRackPrinted = true;
    }

    public void returnToRackList() {
        showTopLevel(new ScheduleListFragment(), menuSchedules, "Schedule Aktif");
        if (activeScheduleId != null) {
            showDetail(RackListFragment.newInstance(activeScheduleId, "Stock Take", ""), menuSchedules, "Rack List");
        }
    }

    public void logout() {
        SessionManager.getInstance(this).clear();
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    public void setBottomNavigationVisible(boolean visible) {
        // Legacy hook: bottom navigation was replaced by the drawer toolbar.
    }

    public void showBackNavigation(String title) {
        if (title != null) {
            toolbarTitle.setText(title);
        }
        setToolbarNavigation(true);
    }

    public void showMenuNavigation(String title) {
        if (title != null) {
            toolbarTitle.setText(title);
        }
        setToolbarNavigation(false);
    }

    private void setToolbarNavigation(boolean showBack) {
        menuButton.setImageResource(showBack ? R.drawable.ic_arrow_back : R.drawable.ic_menu);
        menuButton.setContentDescription(showBack ? "Kembali" : "Buka menu");
        menuButton.setOnClickListener(view -> {
            if (showBack) {
                getOnBackPressedDispatcher().onBackPressed();
            } else {
                drawerLayout.openDrawer(GravityCompat.START);
            }
        });
    }

    private void setActiveMenu(View activeMenu, String title) {
        if (title != null && toolbarTitle != null) {
            toolbarTitle.setText(title);
        }
        View[] menus = {menuDashboard, menuSchedules, menuScanner, menuProfile};
        for (View menu : menus) {
            if (menu == null) {
                continue;
            }
            menu.setBackgroundResource(menu == activeMenu ? R.drawable.bg_drawer_item_selected : R.drawable.bg_drawer_item);
        }
    }
}
