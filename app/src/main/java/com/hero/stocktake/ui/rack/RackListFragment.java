package com.hero.stocktake.ui.rack;

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

import com.google.android.material.chip.Chip;
import com.google.android.material.textfield.TextInputEditText;
import com.hero.stocktake.R;
import com.hero.stocktake.data.local.model.RackDraftSummary;
import com.hero.stocktake.data.repository.DraftRepository;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.ui.MainActivity;

import java.util.ArrayList;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class RackListFragment extends Fragment {
    private static final String ARG_SCHEDULE_ID = "scheduleId";
    private static final String ARG_STOCK_TYPE = "stockType";
    private static final String ARG_SCHEDULE_NO = "scheduleNo";
    private final List<Rack> allRacks = new ArrayList<>();
    private final List<Rack> remoteRacks = new ArrayList<>();
    private final Map<String, RackDraftSummary> draftSummaryByRack = new HashMap<>();
    private RackAdapter adapter;
    private TextView state;
    private TextView count;
    private String selectedFilter = "ALL";
    private String searchText = "";

    public static RackListFragment newInstance(String scheduleId, String stockType, String scheduleNo) {
        RackListFragment fragment = new RackListFragment();
        Bundle args = new Bundle();
        args.putString(ARG_SCHEDULE_ID, scheduleId);
        args.putString(ARG_STOCK_TYPE, stockType);
        args.putString(ARG_SCHEDULE_NO, scheduleNo);
        fragment.setArguments(args);
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_rack_list, container, false);
        String scheduleId = requireArguments().getString(ARG_SCHEDULE_ID);
        String stockType = requireArguments().getString(ARG_STOCK_TYPE, "Stock Take");
        String scheduleNo = requireArguments().getString(ARG_SCHEDULE_NO, "");
        TextView title = view.findViewById(R.id.rackListTitle);
        TextView subtitle = view.findViewById(R.id.rackListSubtitle);
        TextView meta = view.findViewById(R.id.rackListMeta);
        state = view.findViewById(R.id.rackState);
        count = view.findViewById(R.id.rackCount);
        TextInputEditText searchInput = view.findViewById(R.id.rackSearchInput);
        RecyclerView list = view.findViewById(R.id.rackList);
        adapter = new RackAdapter(rack -> ((MainActivity) requireActivity()).openScanner(rack));

        title.setText("Rack List");
        subtitle.setText(scheduleNo.isEmpty() ? "SCHEDULE AKTIF" : scheduleNo);
        meta.setText(stockType + "  |  pilih rack untuk mulai scan.");
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setAdapter(adapter);
        setupFilters(view);
        setupSearch(searchInput);
        DraftRepository.getInstance(requireContext())
                .observeScheduleSummary(scheduleId)
                .observe(getViewLifecycleOwner(), summaries -> {
                    draftSummaryByRack.clear();
                    if (summaries != null) {
                        for (RackDraftSummary summary : summaries) {
                            draftSummaryByRack.put(summary.rackId, summary);
                        }
                    }
                    rebuildRacks();
                });

        state.setVisibility(View.VISIBLE);
        state.setText("Memuat rack list...");
        NetworkRepository.getInstance(requireContext()).getRacks(scheduleId, new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<Rack> racks) {
                remoteRacks.clear();
                remoteRacks.addAll(racks);
                rebuildRacks();
            }

            @Override
            public void onError(String message) {
                state.setVisibility(View.VISIBLE);
                state.setText(message);
            }
        });
        return view;
    }

    private void rebuildRacks() {
        allRacks.clear();
        for (Rack rack : remoteRacks) {
            RackDraftSummary summary = draftSummaryByRack.get(rack.id());
            if (summary == null) {
                allRacks.add(rack);
                continue;
            }
            String updatedAt = new SimpleDateFormat("HH:mm", Locale.getDefault())
                    .format(new Date(summary.lastUpdatedAt));
            int pendingItemCount = Math.max(0, summary.pendingItemCount);
            int pendingQuantity = Math.max(0, summary.pendingQuantity);
            int displayItemCount = rack.itemCount() + pendingItemCount;
            int displayQuantity = rack.totalQuantity() + pendingQuantity;
            if (rack.itemCount() <= 0 && pendingItemCount <= 0) {
                displayItemCount = summary.itemCount;
                displayQuantity = summary.totalQuantity;
            }
            String lastScan = pendingItemCount > 0
                    ? "Draft lokal " + updatedAt
                    : (rack.itemCount() > 0 ? "Submitted" : "Diperbarui " + updatedAt);
            allRacks.add(new Rack(
                    rack.id(),
                    rack.code(),
                    rack.name(),
                    rack.status(),
                    displayItemCount,
                    displayQuantity,
                    rack.printed() ? "Printed" : lastScan,
                    rack.submitted(),
                    rack.printed()
            ));
        }
        applyFilter();
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
        bindFilter(view.findViewById(R.id.filterRackAll), "ALL");
        bindFilter(view.findViewById(R.id.filterRackActive), "ACTIVE");
        bindFilter(view.findViewById(R.id.filterRackCounted), "COUNTED");
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
        List<Rack> filtered = new ArrayList<>();
        for (Rack rack : allRacks) {
            if (!matchesFilter(rack) || !matchesSearch(rack, query)) {
                continue;
            }
            filtered.add(rack);
        }
        adapter.submitList(filtered);
        count.setText(filtered.size() + " rack");
        if (allRacks.isEmpty()) {
            state.setVisibility(View.VISIBLE);
            state.setText("Belum ada rack aktif untuk schedule ini.");
        } else if (filtered.isEmpty()) {
            state.setVisibility(View.VISIBLE);
            state.setText("Tidak ada rack yang cocok dengan pencarian/filter.");
        } else {
            state.setVisibility(View.GONE);
            state.setText("");
        }
    }

    private boolean matchesFilter(Rack rack) {
        if ("ALL".equals(selectedFilter)) {
            return true;
        }
        if ("COUNTED".equals(selectedFilter)) {
            return rack.itemCount() > 0;
        }
        return rack.status().equalsIgnoreCase(selectedFilter);
    }

    private boolean matchesSearch(Rack rack, String query) {
        if (query.isEmpty()) {
            return true;
        }
        String haystack = (rack.code() + " " + rack.name() + " " + rack.status() + " " + rack.lastScan()).toLowerCase(Locale.ROOT);
        return haystack.contains(query);
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showBackNavigation("Rack List");
    }
}
