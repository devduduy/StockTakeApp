package com.hero.stocktake.ui.schedule;

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
        holder.openButton.setText(schedule.progress() == 0 ? "Mulai stock take  ›" : "Lihat rack list  ›");
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

    static class Holder extends RecyclerView.ViewHolder {
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
