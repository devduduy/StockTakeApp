package com.hero.stocktake.ui.schedule;

import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.chip.Chip;
import com.google.android.material.textfield.TextInputEditText;
import com.hero.stocktake.R;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.domain.model.Schedule;
import com.hero.stocktake.ui.MainActivity;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ScheduleListFragment extends Fragment {
    private final List<Schedule> allSchedules = new ArrayList<>();
    private ScheduleAdapter adapter;
    private TextView state;
    private TextView count;
    private TextView headerSubtitle;
    private SwipeRefreshLayout refreshLayout;
    private String locCode;
    private boolean firstResume = true;
    private String selectedFilter = "ALL";
    private String searchText = "";

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_schedule_list, container, false);
        state = view.findViewById(R.id.scheduleState);
        count = view.findViewById(R.id.scheduleCount);
        headerSubtitle = view.findViewById(R.id.scheduleHeaderSubtitle);
        refreshLayout = view.findViewById(R.id.scheduleRefreshLayout);
        TextInputEditText searchInput = view.findViewById(R.id.scheduleSearchInput);
        RecyclerView list = view.findViewById(R.id.scheduleList);
        adapter = new ScheduleAdapter(schedule -> ((MainActivity) requireActivity()).openRackList(schedule));

        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setAdapter(adapter);
        setupFilters(view);
        setupSearch(searchInput);

        locCode = SessionManager.getInstance(requireContext()).getLocCode();
        headerSubtitle.setText("Menampilkan schedule untuk lokasi " + locCode + ".");
        refreshLayout.setOnRefreshListener(() -> loadSchedules(true));
        loadSchedules(false);
        return view;
    }

    private void loadSchedules(boolean userRefresh) {
        if (!userRefresh) {
            refreshLayout.setRefreshing(true);
        }
        state.setVisibility(View.VISIBLE);
        state.setText("Memuat schedule aktif lokasi " + locCode + "...");
        NetworkRepository.getInstance(requireContext()).getActiveSchedules(new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<Schedule> schedules) {
                if (!isAdded()) {
                    return;
                }
                refreshLayout.setRefreshing(false);
                allSchedules.clear();
                if (schedules != null) {
                    allSchedules.addAll(schedules);
                }
                applyFilter();
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                refreshLayout.setRefreshing(false);
                state.setVisibility(View.VISIBLE);
                state.setText(message);
            }
        });
    }

    private void setupSearch(TextInputEditText searchInput) {
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence text, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence text, int start, int before, int count) {
                searchText = text == null ? "" : text.toString();
                applyFilter();
            }

            @Override
            public void afterTextChanged(Editable editable) {
            }
        });
    }

    private void setupFilters(View view) {
        bindFilter(view.findViewById(R.id.filterScheduleAll), "ALL");
        bindFilter(view.findViewById(R.id.filterScheduleOpen), "OPEN");
        bindFilter(view.findViewById(R.id.filterScheduleProgress), "IN PROGRESS");
        bindFilter(view.findViewById(R.id.filterSchedulePartial), "PARTIAL");
    }

    private void bindFilter(Chip chip, String filter) {
        chip.setOnClickListener(view -> {
            selectedFilter = filter;
            applyFilter();
        });
    }

    private void applyFilter() {
        if (adapter == null) {
            return;
        }
        String query = searchText.trim().toLowerCase(Locale.ROOT);
        List<Schedule> filtered = new ArrayList<>();
        for (Schedule schedule : allSchedules) {
            if (!matchesFilter(schedule) || !matchesSearch(schedule, query)) {
                continue;
            }
            filtered.add(schedule);
        }
        adapter.submitList(filtered);
        count.setText(filtered.size() + " schedule");
        if (allSchedules.isEmpty()) {
            state.setVisibility(View.VISIBLE);
            state.setText("Belum ada schedule aktif untuk lokasi user ini.");
        } else if (filtered.isEmpty()) {
            state.setVisibility(View.VISIBLE);
            state.setText("Tidak ada schedule yang cocok dengan pencarian/filter.");
        } else {
            state.setVisibility(View.GONE);
            state.setText("");
        }
    }

    private boolean matchesFilter(Schedule schedule) {
        if ("ALL".equals(selectedFilter)) {
            return true;
        }
        if ("PARTIAL".equals(selectedFilter)) {
            return "PARTIAL".equalsIgnoreCase(schedule.stockType());
        }
        return schedule.status().equalsIgnoreCase(selectedFilter);
    }

    private boolean matchesSearch(Schedule schedule, String query) {
        if (query.isEmpty()) {
            return true;
        }
        String haystack = (
                schedule.number() + " " +
                        schedule.description() + " " +
                        schedule.locationName() + " " +
                        schedule.locCode() + " " +
                        schedule.scheduleDate() + " " +
                        schedule.scheduleTime() + " " +
                        schedule.stockType() + " " +
                        schedule.categorySummary() + " " +
                        schedule.status()
        ).toLowerCase(Locale.ROOT);
        return haystack.contains(query);
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showMenuNavigation("Schedule Aktif");
        if (firstResume) {
            firstResume = false;
        } else if (refreshLayout != null && !refreshLayout.isRefreshing()) {
            loadSchedules(true);
        }
    }
}
