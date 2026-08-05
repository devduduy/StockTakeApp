package com.hero.stocktake.ui.dashboard;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.PagerSnapHelper;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.hero.stocktake.R;
import com.hero.stocktake.data.repository.DraftRepository;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.domain.model.Schedule;
import com.hero.stocktake.ui.MainActivity;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class DashboardFragment extends Fragment {
    private DashboardScheduleAdapter scheduleAdapter;
    private LinearLayoutManager carouselLayoutManager;
    private PagerSnapHelper snapHelper;
    private SwipeRefreshLayout refreshLayout;
    private TextView initials;
    private TextView userName;
    private TextView userRole;
    private TextView carouselIndicator;
    private LinearLayout carouselDots;
    private TextView submittedRackCount;
    private TextView printedRackCount;
    private TextView pendingDraftCount;
    private TextView state;
    private Schedule selectedSchedule;
    private int selectedPosition;
    private int scheduleCount;
    private boolean firstResume = true;
    private final Map<String, RackSummary> rackSummaryByScheduleId = new HashMap<>();

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_dashboard, container, false);
        bindViews(view);
        renderProfile();
        observeDrafts();
        setupCarousel(view);
        refreshLayout.setOnRefreshListener(() -> loadActiveSchedules(true));
        loadActiveSchedules();

        view.findViewById(R.id.startButton).setOnClickListener(v -> ((MainActivity) requireActivity()).openSchedules());
        return view;
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showMenuNavigation("Dashboard");
        if (firstResume) {
            firstResume = false;
        } else if (refreshLayout != null && !refreshLayout.isRefreshing()) {
            loadActiveSchedules(true);
        }
    }

    private void bindViews(View view) {
        initials = view.findViewById(R.id.dashboardInitials);
        userName = view.findViewById(R.id.dashboardUserName);
        userRole = view.findViewById(R.id.dashboardUserRole);
        refreshLayout = view.findViewById(R.id.dashboardRefreshLayout);
        carouselIndicator = view.findViewById(R.id.scheduleCarouselIndicator);
        carouselDots = view.findViewById(R.id.scheduleCarouselDots);
        submittedRackCount = view.findViewById(R.id.scannedRackCount);
        printedRackCount = view.findViewById(R.id.printedRackCount);
        pendingDraftCount = view.findViewById(R.id.pendingDraftCount);
        state = view.findViewById(R.id.dashboardState);
    }

    private void setupCarousel(View view) {
        RecyclerView carousel = view.findViewById(R.id.scheduleCarousel);
        carouselLayoutManager = new LinearLayoutManager(requireContext(), LinearLayoutManager.HORIZONTAL, false);
        scheduleAdapter = new DashboardScheduleAdapter(position -> {
            Schedule schedule = scheduleAdapter.getItem(position);
            if (schedule == null) {
                return;
            }
            ((MainActivity) requireActivity()).openRackList(schedule);
        });
        carousel.setLayoutManager(carouselLayoutManager);
        carousel.setAdapter(scheduleAdapter);
        snapHelper = new PagerSnapHelper();
        snapHelper.attachToRecyclerView(carousel);
        carousel.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(@NonNull RecyclerView recyclerView, int newState) {
                super.onScrollStateChanged(recyclerView, newState);
                if (newState != RecyclerView.SCROLL_STATE_IDLE) {
                    return;
                }
                View snapped = snapHelper.findSnapView(carouselLayoutManager);
                if (snapped == null) {
                    return;
                }
                int position = carouselLayoutManager.getPosition(snapped);
                Schedule schedule = scheduleAdapter.getItem(position);
                if (schedule != null && position != selectedPosition) {
                    selectSchedule(position, schedule);
                }
            }
        });
    }

    private void renderProfile() {
        SessionManager session = SessionManager.getInstance(requireContext());
        String fullName = valueOrDefault(session.getFullName(), "Scanner");
        String role = valueOrDefault(session.getRoleCode(), "SCANNER");
        String locCode = valueOrDefault(session.getLocCode(), SessionManager.DEFAULT_LOC_CODE);
        initials.setText(buildInitials(fullName));
        userName.setText(fullName);
        userRole.setText(formatRole(role) + " - Lokasi " + locCode);
    }

    private void observeDrafts() {
        DraftRepository.getInstance(requireContext())
                .observePendingCount()
                .observe(getViewLifecycleOwner(), count -> pendingDraftCount.setText(String.valueOf(count == null ? 0 : count)));
    }

    private void loadActiveSchedules() {
        loadActiveSchedules(false);
    }

    private void loadActiveSchedules(boolean userRefresh) {
        if (!userRefresh) {
            refreshLayout.setRefreshing(true);
        }
        rackSummaryByScheduleId.clear();
        state.setText("Memuat schedule aktif...");
        carouselIndicator.setText("");
        NetworkRepository.getInstance(requireContext()).getActiveSchedules(new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<Schedule> schedules) {
                if (!isAdded()) {
                    return;
                }
                refreshLayout.setRefreshing(false);
                if (schedules == null || schedules.isEmpty()) {
                    renderEmptySchedule();
                    return;
                }
                scheduleCount = schedules.size();
                scheduleAdapter.submitList(schedules);
                renderDots();
                selectSchedule(0, schedules.get(0));
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                refreshLayout.setRefreshing(false);
                renderEmptySchedule();
                state.setText(message);
            }
        });
    }

    private void selectSchedule(int position, Schedule schedule) {
        selectedPosition = Math.max(0, position);
        selectedSchedule = schedule;
        updateCarouselIndicator();
        updateDots();
        renderScheduleSummary(schedule);
        loadRackSummary(schedule);
    }

    private void renderScheduleSummary(Schedule schedule) {
        RackSummary cachedSummary = rackSummaryByScheduleId.get(schedule.id());
        if (cachedSummary != null) {
            renderRackSummary(cachedSummary);
        } else {
            renderRackSummary(new RackSummary(schedule.scannedRacks(), 0, schedule.totalRacks()));
        }
        state.setText("Geser untuk melihat schedule lain. Tap card untuk buka rack schedule tersebut.");
    }

    private void loadRackSummary(Schedule schedule) {
        if (rackSummaryByScheduleId.containsKey(schedule.id())) {
            return;
        }
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
                RackSummary summary = new RackSummary(submitted, printed, racks.size());
                rackSummaryByScheduleId.put(schedule.id(), summary);
                if (selectedSchedule != null && schedule.id().equals(selectedSchedule.id())) {
                    renderRackSummary(summary);
                }
            }

            @Override
            public void onError(String message) {
                if (isAdded() && selectedSchedule != null && schedule.id().equals(selectedSchedule.id())) {
                    state.setText("Schedule termuat, tetapi ringkasan rack belum tersedia: " + message);
                }
            }
        });
    }

    private void renderRackSummary(RackSummary summary) {
        submittedRackCount.setText(summary.submitted + "/" + summary.total);
        printedRackCount.setText(String.valueOf(summary.printed));
    }

    private void renderEmptySchedule() {
        selectedSchedule = null;
        selectedPosition = 0;
        scheduleCount = 0;
        scheduleAdapter.submitList(Collections.emptyList());
        carouselDots.removeAllViews();
        carouselDots.setVisibility(View.GONE);
        carouselIndicator.setText("0 schedule");
        submittedRackCount.setText("0/0");
        printedRackCount.setText("0");
        state.setText("Belum ada schedule aktif untuk lokasi login ini.");
    }

    private void updateCarouselIndicator() {
        if (scheduleCount <= 1) {
            carouselIndicator.setText(scheduleCount + " schedule");
            return;
        }
        carouselIndicator.setText("Geser " + (selectedPosition + 1) + " dari " + scheduleCount);
    }

    private void renderDots() {
        carouselDots.removeAllViews();
        carouselDots.setVisibility(scheduleCount > 1 ? View.VISIBLE : View.GONE);
        if (scheduleCount <= 1) {
            return;
        }
        for (int index = 0; index < scheduleCount; index++) {
            View dot = new View(requireContext());
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(7), dp(7));
            params.setMargins(dp(4), 0, dp(4), 0);
            dot.setLayoutParams(params);
            carouselDots.addView(dot);
        }
        updateDots();
    }

    private void updateDots() {
        if (carouselDots == null || scheduleCount <= 1) {
            return;
        }
        for (int index = 0; index < carouselDots.getChildCount(); index++) {
            View dot = carouselDots.getChildAt(index);
            boolean selected = index == selectedPosition;
            dot.setBackgroundResource(selected ? R.drawable.bg_carousel_dot_active : R.drawable.bg_carousel_dot_inactive);
            ViewGroup.LayoutParams params = dot.getLayoutParams();
            params.width = dp(selected ? 20 : 7);
            params.height = dp(7);
            dot.setLayoutParams(params);
            dot.animate()
                    .scaleX(selected ? 1.08f : 1f)
                    .scaleY(selected ? 1.08f : 1f)
                    .alpha(selected ? 1f : 0.65f)
                    .setDuration(160)
                    .start();
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
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

    private static class RackSummary {
        final int submitted;
        final int printed;
        final int total;

        RackSummary(int submitted, int printed, int total) {
            this.submitted = submitted;
            this.printed = printed;
            this.total = total;
        }
    }
}
