package com.hero.stocktake.ui.rack;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.hero.stocktake.R;
import com.hero.stocktake.domain.model.Rack;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class RackAdapter extends RecyclerView.Adapter<RackAdapter.Holder> {
    private final List<Rack> racks = new ArrayList<>();
    private final OnRackOpenListener onOpen;

    public RackAdapter(OnRackOpenListener onOpen) {
        this.onOpen = onOpen;
    }

    public void submitList(List<Rack> newRacks) {
        racks.clear();
        racks.addAll(newRacks);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new Holder(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_rack, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull Holder holder, int position) {
        Rack rack = racks.get(position);
        holder.name.setText(rack.name());
        holder.code.setText(rack.code());
        holder.status.setText(resolveStatusLabel(rack));
        String initial = rack.name() == null || rack.name().trim().isEmpty()
                ? "RK"
                : rack.name().trim().substring(0, Math.min(2, rack.name().trim().length())).toUpperCase(Locale.ROOT);
        holder.initial.setText(initial);
        holder.itemCount.setText(String.valueOf(rack.itemCount()));
        holder.totalQuantity.setText(String.valueOf(rack.totalQuantity()));
        holder.lastScan.setText(rack.itemCount() > 0 ? rack.lastScan() : "Belum ada hasil scan");
        holder.open.setOnClickListener(v -> onOpen.open(rack));
        holder.itemView.setOnClickListener(v -> onOpen.open(rack));
    }

    @Override
    public int getItemCount() {
        return racks.size();
    }

    public interface OnRackOpenListener {
        void open(Rack rack);
    }

    private String resolveStatusLabel(Rack rack) {
        if (rack.printed()) {
            return "PRINTED";
        }
        if (rack.itemCount() <= 0) {
            return rack.status();
        }
        if ("Submitted".equalsIgnoreCase(rack.lastScan())) {
            return "SUDAH SUBMIT";
        }
        if (rack.lastScan() != null && rack.lastScan().startsWith("Diperbarui")) {
            return "LOKAL";
        }
        return "DRAFT LOKAL";
    }

    static class Holder extends RecyclerView.ViewHolder {
        final TextView name;
        final TextView code;
        final TextView status;
        final TextView initial;
        final TextView itemCount;
        final TextView totalQuantity;
        final TextView lastScan;
        final View open;

        Holder(View view) {
            super(view);
            name = view.findViewById(R.id.rackName);
            code = view.findViewById(R.id.rackCode);
            status = view.findViewById(R.id.rackStatus);
            initial = view.findViewById(R.id.rackInitial);
            itemCount = view.findViewById(R.id.rackItemCount);
            totalQuantity = view.findViewById(R.id.rackTotalQuantity);
            lastScan = view.findViewById(R.id.rackLastScan);
            open = view.findViewById(R.id.openRackButton);
        }
    }
}
