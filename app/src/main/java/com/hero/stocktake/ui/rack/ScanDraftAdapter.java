package com.hero.stocktake.ui.rack;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.hero.stocktake.R;
import com.hero.stocktake.data.local.entity.LocalScanDraft;

import java.util.ArrayList;
import java.util.List;

public class ScanDraftAdapter extends RecyclerView.Adapter<ScanDraftAdapter.Holder> {
    private final List<LocalScanDraft> items = new ArrayList<>();
    private final OnDraftActionListener actionListener;
    private boolean actionsEnabled = true;

    public ScanDraftAdapter(OnDraftActionListener actionListener) {
        this.actionListener = actionListener;
    }

    public void setActionsEnabled(boolean actionsEnabled) {
        this.actionsEnabled = actionsEnabled;
        notifyDataSetChanged();
    }

    public void submitList(List<LocalScanDraft> drafts) {
        items.clear();
        if (drafts != null) {
            items.addAll(drafts);
        }
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new Holder(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_scan_draft, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull Holder holder, int position) {
        LocalScanDraft draft = items.get(position);
        holder.product.setText(draft.pluDescription);
        holder.barcode.setText(draft.barcode + " - PLU " + draft.plu);
        holder.inputType.setText(draft.inputType + " - " + draft.syncStatus);
        holder.quantity.setText("x" + draft.scanQty);
        holder.latestBadge.setText("Terbaru");
        holder.latestBadge.setVisibility(position == 0 ? View.VISIBLE : View.GONE);
        boolean editable = actionsEnabled && !"SYNCED".equalsIgnoreCase(draft.syncStatus);
        holder.actions.setVisibility(editable ? View.VISIBLE : View.GONE);
        holder.editQuantity.setOnClickListener(v -> actionListener.onEditQuantity(draft));
        holder.deleteItem.setOnClickListener(v -> actionListener.onDelete(draft));
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    public interface OnDraftActionListener {
        void onEditQuantity(LocalScanDraft draft);

        void onDelete(LocalScanDraft draft);
    }

    static class Holder extends RecyclerView.ViewHolder {
        final TextView product;
        final TextView barcode;
        final TextView inputType;
        final TextView quantity;
        final TextView latestBadge;
        final View actions;
        final View editQuantity;
        final View deleteItem;

        Holder(View view) {
            super(view);
            product = view.findViewById(R.id.productName);
            barcode = view.findViewById(R.id.barcode);
            inputType = view.findViewById(R.id.inputType);
            quantity = view.findViewById(R.id.quantity);
            latestBadge = view.findViewById(R.id.latestBadge);
            actions = view.findViewById(R.id.draftActions);
            editQuantity = view.findViewById(R.id.editQuantityButton);
            deleteItem = view.findViewById(R.id.deleteItemButton);
        }
    }
}
