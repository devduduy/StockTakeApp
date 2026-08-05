package com.hero.stocktake.ui.rack;

import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.card.MaterialCardView;
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
        applyRackState(holder, rack);
        String initial = rack.name() == null || rack.name().trim().isEmpty()
                ? "RK"
                : rack.name().trim().substring(0, Math.min(2, rack.name().trim().length())).toUpperCase(Locale.ROOT);
        holder.initial.setText(initial);
        holder.itemCount.setText(String.valueOf(rack.itemCount()));
        holder.totalQuantity.setText(String.valueOf(rack.totalQuantity()));
        holder.lastScan.setText(resolveSupportText(rack));
        holder.openText.setText(resolveActionText(rack));
        holder.openText.setVisibility(rack.printed() ? View.GONE : View.VISIBLE);
        holder.openIcon.setVisibility(rack.printed() ? View.GONE : View.VISIBLE);
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

    private String resolveSupportText(Rack rack) {
        if (rack.printed()) {
            return "Terkunci print, mode lihat item";
        }
        if (rack.itemCount() <= 0) {
            return "Belum ada hasil scan";
        }
        if ("Submitted".equalsIgnoreCase(rack.lastScan())) {
            return "Hasil rack sudah tersubmit";
        }
        return rack.lastScan();
    }

    private String resolveActionText(Rack rack) {
        if (rack.itemCount() <= 0) {
            return "Mulai scan";
        }
        if ("Submitted".equalsIgnoreCase(rack.lastScan())) {
            return "Lihat item";
        }
        return "Lanjut scan";
    }

    private void applyRackState(Holder holder, Rack rack) {
        int chipBackground;
        int chipText;
        int strokeColor;
        int iconBackground;
        int iconText;

        if (rack.printed()) {
            chipBackground = R.color.hero_blue_soft;
            chipText = R.color.hero_blue;
            strokeColor = R.color.hero_blue;
            iconBackground = R.color.hero_blue_soft;
            iconText = R.color.hero_blue;
        } else if ("Submitted".equalsIgnoreCase(rack.lastScan())) {
            chipBackground = R.color.hero_green_soft;
            chipText = R.color.hero_green;
            strokeColor = R.color.hero_green;
            iconBackground = R.color.hero_green_soft;
            iconText = R.color.hero_green;
        } else if (rack.itemCount() > 0) {
            chipBackground = R.color.hero_amber_soft;
            chipText = R.color.hero_amber;
            strokeColor = R.color.hero_amber;
            iconBackground = R.color.hero_amber_soft;
            iconText = R.color.hero_amber;
        } else {
            chipBackground = R.color.hero_neutral_soft;
            chipText = R.color.hero_neutral;
            strokeColor = R.color.hero_outline;
            iconBackground = R.color.hero_neutral_soft;
            iconText = R.color.hero_neutral;
        }

        holder.card.setStrokeColor(ContextCompat.getColor(holder.itemView.getContext(), strokeColor));
        holder.status.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), chipText));
        holder.status.setBackground(roundedDrawable(holder, chipBackground, 100));
        holder.initial.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), iconText));
        holder.initial.setBackground(roundedDrawable(holder, iconBackground, 10));
    }

    private GradientDrawable roundedDrawable(Holder holder, int colorRes, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(ContextCompat.getColor(holder.itemView.getContext(), colorRes));
        drawable.setCornerRadius(radiusDp * holder.itemView.getResources().getDisplayMetrics().density);
        return drawable;
    }

    static class Holder extends RecyclerView.ViewHolder {
        final MaterialCardView card;
        final TextView name;
        final TextView code;
        final TextView status;
        final TextView initial;
        final TextView itemCount;
        final TextView totalQuantity;
        final TextView lastScan;
        final TextView openText;
        final ImageView openIcon;
        final View open;

        Holder(View view) {
            super(view);
            card = (MaterialCardView) view;
            name = view.findViewById(R.id.rackName);
            code = view.findViewById(R.id.rackCode);
            status = view.findViewById(R.id.rackStatus);
            initial = view.findViewById(R.id.rackInitial);
            itemCount = view.findViewById(R.id.rackItemCount);
            totalQuantity = view.findViewById(R.id.rackTotalQuantity);
            lastScan = view.findViewById(R.id.rackLastScan);
            openText = view.findViewById(R.id.openRackText);
            openIcon = view.findViewById(R.id.openRackIcon);
            open = view.findViewById(R.id.openRackButton);
        }
    }
}
