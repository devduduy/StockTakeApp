package com.hero.stocktake.ui.dashboard;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.hero.stocktake.R;
import com.hero.stocktake.data.repository.DraftRepository;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.domain.model.Schedule;
import com.hero.stocktake.ui.MainActivity;

import java.util.List;
import java.util.Locale;

public class DashboardFragment extends Fragment {
    private TextView initials;
    private TextView userName;
    private TextView userRole;
    private TextView scheduleNumber;
    private TextView scheduleDesc;
    private TextView scheduleStatus;
    private TextView storeName;
    private TextView scheduleMeta;
    private TextView progressText;
    private ProgressBar progressBar;
    private TextView scannedRackCount;
    private TextView printedRackCount;
    private TextView pendingDraftCount;
    private TextView state;
    private View continueButton;
    private Schedule activeSchedule;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_dashboard, container, false);
        bindViews(view);
        renderProfile();
        observeDrafts();
        loadActiveSchedule();

        view.findViewById(R.id.startButton).setOnClickListener(v -> ((MainActivity) requireActivity()).openSchedules());
        continueButton.setOnClickListener(v -> {
            if (activeSchedule == null) {
                ((MainActivity) requireActivity()).openSchedules();
                return;
            }
            ((MainActivity) requireActivity()).openRackList(activeSchedule);
        });
        return view;
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showMenuNavigation("Dashboard");
    }

    private void bindViews(View view) {
        initials = view.findViewById(R.id.dashboardInitials);
        userName = view.findViewById(R.id.dashboardUserName);
        userRole = view.findViewById(R.id.dashboardUserRole);
        scheduleNumber = view.findViewById(R.id.activeScheduleNumber);
        scheduleDesc = view.findViewById(R.id.activeScheduleDesc);
        scheduleStatus = view.findViewById(R.id.activeScheduleStatus);
        storeName = view.findViewById(R.id.dashboardStore);
        scheduleMeta = view.findViewById(R.id.activeScheduleMeta);
        progressText = view.findViewById(R.id.activeScheduleProgress);
        progressBar = view.findViewById(R.id.activeScheduleProgressBar);
        scannedRackCount = view.findViewById(R.id.scannedRackCount);
        printedRackCount = view.findViewById(R.id.printedRackCount);
        pendingDraftCount = view.findViewById(R.id.pendingDraftCount);
        state = view.findViewById(R.id.dashboardState);
        continueButton = view.findViewById(R.id.continueButton);
    }

    private void renderProfile() {
        SessionManager session = SessionManager.getInstance(requireContext());
        String fullName = valueOrDefault(session.getFullName(), "Scanner");
        String role = valueOrDefault(session.getRoleCode(), "SCANNER");
        String locCode = valueOrDefault(session.getLocCode(), SessionManager.DEFAULT_LOC_CODE);
        initials.setText(buildInitials(fullName));
        userName.setText(fullName);
        userRole.setText(formatRole(role) + " • Lokasi " + locCode);
    }

    private void observeDrafts() {
        DraftRepository.getInstance(requireContext())
                .observePendingCount()
                .observe(getViewLifecycleOwner(), count -> pendingDraftCount.setText(String.valueOf(count == null ? 0 : count)));
    }

    private void loadActiveSchedule() {
        state.setText("Memuat schedule aktif...");
        continueButton.setVisibility(View.GONE);
        NetworkRepository.getInstance(requireContext()).getActiveSchedules(new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<Schedule> schedules) {
                if (!isAdded()) {
                    return;
                }
                if (schedules == null || schedules.isEmpty()) {
                    renderEmptySchedule();
                    return;
                }
                activeSchedule = schedules.get(0);
                renderSchedule(activeSchedule);
                loadRackSummary(activeSchedule);
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                renderEmptySchedule();
                state.setText(message);
            }
        });
    }

    private void renderSchedule(Schedule schedule) {
        scheduleNumber.setText(valueOrDefault(schedule.number(), "-"));
        scheduleDesc.setText(valueOrDefault(schedule.description(), "Stock Take"));
        scheduleStatus.setText(valueOrDefault(schedule.status(), "-"));
        storeName.setText(valueOrDefault(schedule.locationName(), schedule.locCode()) + " • " + valueOrDefault(schedule.locCode(), "-"));
        scheduleMeta.setText(schedule.scheduleDate() + " • " + schedule.scheduleTime() + " • " + schedule.stockType() + " • " + schedule.categorySummary());
        renderProgress(schedule.progress(), schedule.scannedRacks(), schedule.totalRacks());
        state.setText("Siap digunakan. Pilih rack untuk mulai atau lanjut scan.");
        continueButton.setVisibility(View.VISIBLE);
    }

    private void loadRackSummary(Schedule schedule) {
        NetworkRepository.getInstance(requireContext()).getRacks(schedule.id(), new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<Rack> racks) {
                if (!isAdded() || racks == null) {
                    return;
                }
                int submitted = 0;
                int printed = 0;
                for (Rack rack : racks) {
                    if (rack.submitted()) {
                        submitted++;
                    }
                    if (rack.printed()) {
                        printed++;
                    }
                }
                int total = racks.size();
                int progress = total == 0 ? schedule.progress() : Math.round((submitted * 100f) / total);
                scannedRackCount.setText(submitted + "/" + total);
                printedRackCount.setText(String.valueOf(printed));
                renderProgress(progress, submitted, total);
            }

            @Override
            public void onError(String message) {
                if (isAdded()) {
                    state.setText("Schedule termuat, tetapi ringkasan rack belum tersedia: " + message);
                }
            }
        });
    }

    private void renderEmptySchedule() {
        activeSchedule = null;
        scheduleNumber.setText("Belum ada schedule");
        scheduleDesc.setText("Schedule aktif belum tersedia untuk lokasi login ini.");
        scheduleStatus.setText("-");
        storeName.setText("Lokasi mengikuti user login.");
        scheduleMeta.setText("Buka halaman schedule untuk refresh atau cek filter lokasi.");
        scannedRackCount.setText("0/0");
        printedRackCount.setText("0");
        renderProgress(0, 0, 0);
        continueButton.setVisibility(View.GONE);
    }

    private void renderProgress(int progress, int scanned, int total) {
        int safeProgress = Math.max(0, Math.min(100, progress));
        progressText.setText(safeProgress + "% • " + scanned + "/" + total + " rack");
        progressBar.setProgress(safeProgress);
    }

    private String formatRole(String roleCode) {
        return roleCode.replace('_', ' ').toUpperCase(Locale.ROOT);
    }

    private String buildInitials(String name) {
        String[] parts = name.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) {
            return "SC";
        }
        String first = parts[0].substring(0, 1);
        String second = parts.length > 1 ? parts[1].substring(0, 1) : "";
        return (first + second).toUpperCase(Locale.ROOT);
    }

    private String valueOrDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }
}
