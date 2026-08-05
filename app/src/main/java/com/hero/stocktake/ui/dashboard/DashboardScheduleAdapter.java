package com.hero.stocktake.ui.dashboard;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.hero.stocktake.R;
import com.hero.stocktake.domain.model.Schedule;

import java.util.ArrayList;
import java.util.List;

class DashboardScheduleAdapter extends RecyclerView.Adapter<DashboardScheduleAdapter.ScheduleViewHolder> {
    private static final float PEEKING_CARD_WIDTH_RATIO = 0.78f;

    interface OnScheduleClickListener {
        void onScheduleClick(int position);
    }

    private final List<Schedule> schedules = new ArrayList<>();
    private final OnScheduleClickListener listener;

    DashboardScheduleAdapter(OnScheduleClickListener listener) {
        this.listener = listener;
    }

    void submitList(List<Schedule> items) {
        schedules.clear();
        schedules.addAll(items);
        notifyDataSetChanged();
    }

    Schedule getItem(int position) {
        if (position < 0 || position >= schedules.size()) {
            return null;
        }
        return schedules.get(position);
    }

    @NonNull
    @Override
    public ScheduleViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_dashboard_schedule, parent, false);
        if (parent.getMeasuredWidth() > 0) {
            view.getLayoutParams().width = resolveCardWidth(parent.getMeasuredWidth());
        }
        return new ScheduleViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ScheduleViewHolder holder, int position) {
        Schedule schedule = schedules.get(position);
        holder.number.setText(valueOrDefault(schedule.number(), "-"));
        holder.description.setText(valueOrDefault(schedule.description(), "Stock Take"));
        holder.status.setText(valueOrDefault(schedule.status(), "-"));
        holder.store.setText(valueOrDefault(schedule.locationName(), schedule.locCode()) + " - " + valueOrDefault(schedule.locCode(), "-"));
        holder.meta.setText(schedule.scheduleDate() + " - " + schedule.scheduleTime() + " - " + schedule.stockType() + " - " + schedule.categorySummary());
        holder.progress.setText(schedule.progress() + "% - " + schedule.scannedRacks() + "/" + schedule.totalRacks() + " rack");
        holder.progressBar.setProgress(Math.max(0, Math.min(100, schedule.progress())));
        holder.itemView.setOnClickListener(view -> {
            int adapterPosition = holder.getBindingAdapterPosition();
            if (adapterPosition != RecyclerView.NO_POSITION) {
                listener.onScheduleClick(adapterPosition);
            }
        });
    }

    @Override
    public int getItemCount() {
        return schedules.size();
    }

    private String valueOrDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private int resolveCardWidth(int parentWidth) {
        if (schedules.size() <= 1) {
            return parentWidth;
        }
        return Math.round(parentWidth * PEEKING_CARD_WIDTH_RATIO);
    }

    static class ScheduleViewHolder extends RecyclerView.ViewHolder {
        final TextView number;
        final TextView description;
        final TextView status;
        final TextView store;
        final TextView meta;
        final TextView progress;
        final ProgressBar progressBar;

        ScheduleViewHolder(@NonNull View view) {
            super(view);
            number = view.findViewById(R.id.dashboardScheduleNo);
            description = view.findViewById(R.id.dashboardScheduleDesc);
            status = view.findViewById(R.id.dashboardScheduleStatus);
            store = view.findViewById(R.id.dashboardScheduleStore);
            meta = view.findViewById(R.id.dashboardScheduleMeta);
            progress = view.findViewById(R.id.dashboardScheduleProgress);
            progressBar = view.findViewById(R.id.dashboardScheduleProgressBar);
        }
    }
}
