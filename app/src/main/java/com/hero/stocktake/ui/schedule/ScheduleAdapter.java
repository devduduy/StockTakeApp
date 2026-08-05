package com.hero.stocktake.ui.schedule;

import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.card.MaterialCardView;
import com.hero.stocktake.R;
import com.hero.stocktake.domain.model.Schedule;

import java.util.ArrayList;
import java.util.List;

public class ScheduleAdapter extends RecyclerView.Adapter<ScheduleAdapter.Holder> {
    private final List<Schedule> schedules = new ArrayList<>();
    private final OnScheduleOpenListener onOpen;

    public ScheduleAdapter(OnScheduleOpenListener onOpen) {
        this.onOpen = onOpen;
    }

    public void submitList(List<Schedule> newSchedules) {
        schedules.clear();
        schedules.addAll(newSchedules);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new Holder(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_schedule, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull Holder holder, int position) {
        Schedule schedule = schedules.get(position);
        holder.number.setText(schedule.number());
        holder.description.setText(schedule.description());
        holder.store.setText(schedule.locationName() + " (" + schedule.locCode() + ")");
        holder.date.setText(schedule.scheduleDate());
        holder.time.setText(schedule.scheduleTime());
        holder.type.setText(schedule.stockType());
        holder.category.setText(schedule.categorySummary());
        holder.status.setText(schedule.status());
        holder.progress.setText(schedule.progress() + "% - " + schedule.scannedRacks() + " / " + schedule.totalRacks() + " rack selesai");
        holder.progressBar.setProgress(schedule.progress());
        holder.openButton.setText(schedule.progress() == 0 ? "Mulai stock take" : "Lihat rack list");
        applyScheduleState(holder, schedule);
        holder.openButton.setOnClickListener(v -> onOpen.open(schedule));
        holder.itemView.setOnClickListener(v -> onOpen.open(schedule));
    }

    @Override
    public int getItemCount() {
        return schedules.size();
    }

    public interface OnScheduleOpenListener {
        void open(Schedule schedule);
    }

    private void applyScheduleState(Holder holder, Schedule schedule) {
        boolean partial = "PARTIAL".equalsIgnoreCase(schedule.stockType());
        holder.type.setBackground(roundedDrawable(holder, partial ? R.color.hero_amber_soft : R.color.hero_blue_soft, 7));
        holder.type.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), partial ? R.color.hero_amber : R.color.hero_blue));

        int statusBackground;
        int statusText;
        int stroke;
        String status = schedule.status() == null ? "" : schedule.status().toUpperCase();
        if (status.contains("PROGRESS")) {
            statusBackground = R.color.hero_green_soft;
            statusText = R.color.hero_green;
            stroke = R.color.hero_green;
        } else if (status.contains("OPEN")) {
            statusBackground = R.color.hero_blue_soft;
            statusText = R.color.hero_blue;
            stroke = R.color.hero_blue;
        } else {
            statusBackground = R.color.hero_neutral_soft;
            statusText = R.color.hero_neutral;
            stroke = R.color.hero_outline;
        }
        holder.status.setBackground(roundedDrawable(holder, statusBackground, 100));
        holder.status.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), statusText));
        holder.card.setStrokeColor(ContextCompat.getColor(holder.itemView.getContext(), stroke));
    }

    private GradientDrawable roundedDrawable(Holder holder, int colorRes, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(ContextCompat.getColor(holder.itemView.getContext(), colorRes));
        drawable.setCornerRadius(radiusDp * holder.itemView.getResources().getDisplayMetrics().density);
        return drawable;
    }

    static class Holder extends RecyclerView.ViewHolder {
        final MaterialCardView card;
        final TextView number;
        final TextView description;
        final TextView store;
        final TextView date;
        final TextView time;
        final TextView type;
        final TextView category;
        final TextView status;
        final TextView progress;
        final TextView openButton;
        final ProgressBar progressBar;

        Holder(View view) {
            super(view);
            card = (MaterialCardView) view;
            number = view.findViewById(R.id.scheduleNo);
            description = view.findViewById(R.id.scheduleDesc);
            store = view.findViewById(R.id.scheduleStore);
            date = view.findViewById(R.id.scheduleDate);
            time = view.findViewById(R.id.scheduleTime);
            type = view.findViewById(R.id.scheduleType);
            category = view.findViewById(R.id.scheduleCategory);
            status = view.findViewById(R.id.scheduleStatus);
            progress = view.findViewById(R.id.scheduleProgress);
            progressBar = view.findViewById(R.id.progressBar);
            openButton = view.findViewById(R.id.openScheduleButton);
        }
    }
}
