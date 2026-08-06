package com.hero.stocktake.ui.scanner;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.hero.stocktake.R;
import com.hero.stocktake.data.local.entity.LocalScanDraft;
import com.hero.stocktake.data.remote.dto.ItemLookupDto;
import com.hero.stocktake.data.repository.DraftRepository;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.domain.DraftRules;
import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.ui.MainActivity;
import com.hero.stocktake.ui.rack.ScanDraftAdapter;

import java.util.List;

public class ScannerFragment extends Fragment {
    private static final String ARG_SCHEDULE_ID = "scheduleId";
    private static final String ARG_RACK_ID = "rackId";
    private static final String ARG_RACK_TITLE = "rackTitle";
    private static final String ARG_RACK_SUBMITTED = "rackSubmitted";
    private static final String ARG_RACK_PRINTED = "rackPrinted";

    private int quantity = 1;
    private int lookupRequestVersion = 0;
    private ItemLookupDto currentItem;
    private String currentItemBarcode;
    private TextInputEditText quantityInput;
    private TextView productTitle;
    private TextView pluText;
    private TextView barcodeText;
    private TextView validBadge;
    private TextView scanSummary;
    private TextInputEditText barcodeInput;
    private TextInputLayout barcodeLayout;
    private RecyclerView scannedItemList;
    private View scanFormCard;
    private View scanActionPanel;
    private View listHeader;
    private SwipeRefreshLayout refreshLayout;
    private MaterialButton addButton;
    private MaterialButton submitButton;
    private List<LocalScanDraft> currentDrafts;
    private boolean submitting = false;
    private final Handler lookupHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingLookup;
    private boolean rackSubmitted;
    private boolean rackPrinted;
    private boolean localSubmitted;
    private boolean lookupInFlight;

    public static ScannerFragment newInstance(String scheduleId, String rackId, String rackTitle, boolean rackSubmitted, boolean rackPrinted) {
        ScannerFragment fragment = new ScannerFragment();
        Bundle args = new Bundle();
        args.putString(ARG_SCHEDULE_ID, scheduleId);
        args.putString(ARG_RACK_ID, rackId);
        args.putString(ARG_RACK_TITLE, rackTitle);
        args.putBoolean(ARG_RACK_SUBMITTED, rackSubmitted);
        args.putBoolean(ARG_RACK_PRINTED, rackPrinted);
        fragment.setArguments(args);
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_scanner, container, false);
        quantityInput = view.findViewById(R.id.quantityInput);
        productTitle = view.findViewById(R.id.productTitle);
        pluText = view.findViewById(R.id.pluText);
        barcodeText = view.findViewById(R.id.barcodeText);
        validBadge = view.findViewById(R.id.validBadge);
        scanSummary = view.findViewById(R.id.scanSummary);
        barcodeInput = view.findViewById(R.id.barcodeInput);
        barcodeLayout = view.findViewById(R.id.barcodeLayout);
        scannedItemList = view.findViewById(R.id.scannedItemList);
        scanFormCard = view.findViewById(R.id.scanFormCard);
        scanActionPanel = view.findViewById(R.id.scanActionPanel);
        listHeader = view.findViewById(R.id.listHeader);
        refreshLayout = view.findViewById(R.id.scannerRefreshLayout);
        addButton = view.findViewById(R.id.addButton);
        submitButton = view.findViewById(R.id.submitButton);
        barcodeLayout.setEndIconOnClickListener(v -> {
            barcodeInput.setText("");
            barcodeLayout.setError(null);
            barcodeInput.requestFocus();
        });
        String scheduleId = requireArguments().getString(ARG_SCHEDULE_ID);
        String rackId = requireArguments().getString(ARG_RACK_ID);
        rackSubmitted = requireArguments().getBoolean(ARG_RACK_SUBMITTED, false);
        rackPrinted = requireArguments().getBoolean(ARG_RACK_PRINTED, false);
        DraftRepository repository = DraftRepository.getInstance(requireContext());
        ScanDraftAdapter draftAdapter = new ScanDraftAdapter(new ScanDraftAdapter.OnDraftActionListener() {
            @Override
            public void onEditQuantity(LocalScanDraft draft) {
                showEditQuantityDialog(scheduleId, rackId, repository, draft);
            }

            @Override
            public void onDelete(LocalScanDraft draft) {
                showDeleteDialog(scheduleId, rackId, repository, draft);
            }
        });
        scannedItemList.setLayoutManager(new LinearLayoutManager(requireContext()));
        scannedItemList.setAdapter(draftAdapter);
        repository.observeRack(scheduleId, rackId).observe(getViewLifecycleOwner(), drafts -> {
            currentDrafts = drafts;
            localSubmitted = hasSyncedDraft(drafts);
            draftAdapter.setActionsEnabled(canEditDraftItems());
            draftAdapter.submitList(drafts);
            updateScanSummary(drafts);
            if (drafts != null && !drafts.isEmpty()) {
                scannedItemList.scrollToPosition(0);
            }
            applyRackMode();
        });
        refreshLayout.setOnRefreshListener(() -> refreshRackFromServer(repository, scheduleId, rackId, true));
        refreshRackFromServer(repository, scheduleId, rackId, false);

        barcodeInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                scheduleLookup(s.toString());
            }

            @Override
            public void afterTextChanged(Editable s) {
            }
        });

        view.findViewById(R.id.minusButton).setOnClickListener(v -> {
            quantity = Math.max(1, readQuantity() - 1);
            quantityInput.setText(String.valueOf(quantity));
            quantityInput.setSelection(quantityInput.length());
        });
        view.findViewById(R.id.plusButton).setOnClickListener(v -> {
            quantity = readQuantity() + 1;
            quantityInput.setText(String.valueOf(quantity));
            quantityInput.setSelection(quantityInput.length());
        });
        addButton.setOnClickListener(v -> prepareSave());
        submitButton.setOnClickListener(v -> showSubmitConfirmation(scheduleId, rackId, repository));
        applyRackMode();
        lookupBarcode(barcodeInput.getText() == null ? "" : barcodeInput.getText().toString());
        barcodeInput.requestFocus();
        barcodeInput.postDelayed(() -> {
            if (isAdded()) {
                barcodeInput.requestFocus();
            }
        }, 200);
        return view;
    }

    private boolean hasSyncedDraft(List<LocalScanDraft> drafts) {
        if (drafts == null) {
            return false;
        }
        for (LocalScanDraft draft : drafts) {
            if ("SYNCED".equalsIgnoreCase(draft.syncStatus)) {
                return true;
            }
        }
        return false;
    }

    private boolean canEditDraftItems() {
        return !rackPrinted && !rackSubmitted && !localSubmitted && !submitting;
    }

    private boolean canAddNewScan() {
        return !rackPrinted && !submitting;
    }

    private void applyRackMode() {
        boolean canAdd = canAddNewScan();
        if (scanFormCard != null) {
            scanFormCard.setVisibility(rackPrinted ? View.GONE : View.VISIBLE);
        }
        if (scanActionPanel != null) {
            scanActionPanel.setVisibility(rackPrinted ? View.GONE : View.VISIBLE);
        }
        if (listHeader != null && rackPrinted) {
            listHeader.setVisibility(View.VISIBLE);
        }
        if (barcodeInput != null) {
            barcodeInput.setEnabled(canAdd);
        }
        if (quantityInput != null) {
            quantityInput.setEnabled(canAdd);
        }
        if (addButton != null) {
            addButton.setEnabled(canAdd);
            addButton.setText("Simpan item");
        }
        if (submitButton != null) {
            submitButton.setEnabled(!rackPrinted && !submitting);
        }
        if (rackPrinted) {
            barcodeLayout.setError(null);
        }
    }

    private void scheduleLookup(String rawBarcode) {
        if (pendingLookup != null) {
            lookupHandler.removeCallbacks(pendingLookup);
        }
        String barcode = rawBarcode == null ? "" : rawBarcode;
        barcodeLayout.setError(null);
        if (barcode.trim().isEmpty()) {
            lookupBarcode(barcode);
            return;
        }
        pendingLookup = () -> lookupBarcode(barcode);
        lookupHandler.postDelayed(pendingLookup, 250);
    }

    private void showSubmitConfirmation(String scheduleId, String rackId, DraftRepository repository) {
        if (submitting) {
            return;
        }
        int submitLines = 0;
        int submitQuantity = 0;
        if (currentDrafts != null) {
            for (LocalScanDraft draft : currentDrafts) {
                if (!isPendingDraft(draft)) {
                    continue;
                }
                submitLines += 1;
                submitQuantity += draft.scanQty;
            }
        }
        if (submitLines <= 0) {
            Toast.makeText(requireContext(), "Belum ada data scan untuk disubmit.", Toast.LENGTH_SHORT).show();
            return;
        }

        String message = "Data yang akan dikirim:\n"
                + submitLines + " item terscan\n"
                + "Total quantity " + submitQuantity + "\n\n"
                + "Pastikan rack dan quantity sudah benar sebelum submit.";

        new AlertDialog.Builder(requireContext())
                .setTitle("Submit hasil rack?")
                .setMessage(message)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Submit", (dialog, which) -> submitRack(scheduleId, rackId, repository))
                .show();
    }

    private void submitRack(String scheduleId, String rackId, DraftRepository repository) {
        setSubmitting(true);
        repository.submitRack(scheduleId, rackId, new DraftRepository.SubmitCallback() {
            @Override
            public void onSuccess(int submittedLines) {
                if (!isAdded()) {
                    return;
                }
                setSubmitting(false);
                if (submittedLines <= 0) {
                    Toast.makeText(requireContext(), "Belum ada data scan untuk disubmit.", Toast.LENGTH_SHORT).show();
                    return;
                }
                ((MainActivity) requireActivity()).markActiveRackSubmitted();
                ((MainActivity) requireActivity()).showSubmissionSuccess(submittedLines);
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                setSubmitting(false);
                Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void setSubmitting(boolean submitting) {
        this.submitting = submitting;
        if (submitButton != null) {
            submitButton.setEnabled(!submitting && !rackPrinted);
            submitButton.setText(submitting ? "Mengirim..." : "Submit");
        }
        if (addButton != null) {
            addButton.setEnabled(!submitting && !rackPrinted);
        }
        if (barcodeInput != null) {
            barcodeInput.setEnabled(!submitting && !rackPrinted);
        }
        if (quantityInput != null) {
            quantityInput.setEnabled(!submitting && !rackPrinted);
        }
    }

    private void lookupBarcode(String rawBarcode) {
        if (rackPrinted) {
            return;
        }
        String barcode = rawBarcode == null ? "" : rawBarcode.trim();
        barcodeLayout.setError(null);
        currentItem = null;
        currentItemBarcode = null;
        lookupInFlight = false;
        lookupRequestVersion += 1;
        int requestVersion = lookupRequestVersion;

        if (barcode.isEmpty()) {
            productTitle.setText("Siap menerima barcode");
            pluText.setText("PLU\n-");
            barcodeText.setText("Barcode\n-");
            validBadge.setText("SIAP");
            return;
        }
        if (barcode.length() < 4) {
            productTitle.setText("Masukkan barcode atau PLU");
            pluText.setText("PLU\n-");
            barcodeText.setText("Barcode\n" + barcode);
            validBadge.setText("MENUNGGU");
            return;
        }

        productTitle.setText("Mencari item...");
        lookupInFlight = true;
        pluText.setText("PLU\n-");
        barcodeText.setText("Barcode\n" + barcode);
        validBadge.setText("Lookup");
        String scheduleId = requireArguments().getString(ARG_SCHEDULE_ID);
        NetworkRepository.getInstance(requireContext()).lookupItem(barcode, scheduleId, new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(ItemLookupDto item) {
                if (requestVersion != lookupRequestVersion) {
                    return;
                }
                lookupInFlight = false;
                currentItem = item;
                currentItemBarcode = barcode;
                productTitle.setText(item.pluDescription + " (" + item.plu + ")");
                pluText.setText("PLU\n" + item.plu);
                barcodeText.setText("Barcode\n" + barcode);
                validBadge.setText("Valid");
            }

            @Override
            public void onError(String message) {
                if (requestVersion != lookupRequestVersion) {
                    return;
                }
                lookupInFlight = false;
                productTitle.setText("Item tidak ditemukan");
                pluText.setText("PLU\n-");
                barcodeText.setText("Barcode\n" + barcode);
                validBadge.setText("Not Found");
                barcodeLayout.setError(message);
            }
        });
    }

    private void prepareSave() {
        if (!canAddNewScan()) {
            Toast.makeText(requireContext(), "Rack sudah print. Scan tambahan tidak diperbolehkan.", Toast.LENGTH_LONG).show();
            return;
        }
        String barcode = barcodeInput.getText() == null ? "" : barcodeInput.getText().toString().trim();
        Integer parsedQuantity = readPositiveQuantity();
        if (parsedQuantity == null) {
            quantityInput.setError("Quantity harus lebih dari 0.");
            quantityInput.requestFocus();
            return;
        }
        quantityInput.setError(null);
        quantity = parsedQuantity;
        try {
            DraftRules.validate(barcode, quantity);
        } catch (IllegalArgumentException error) {
            barcodeLayout.setError(error.getMessage());
            barcodeInput.requestFocus();
            return;
        }
        if (lookupInFlight) {
            barcodeLayout.setError("Lookup barcode masih berjalan.");
            return;
        }
        if (currentItem == null || currentItemBarcode == null || !currentItemBarcode.equals(barcode)) {
            barcodeLayout.setError("Item belum valid. Tunggu lookup barcode selesai.");
            barcodeInput.requestFocus();
            return;
        }

        String scheduleId = requireArguments().getString(ARG_SCHEDULE_ID);
        String rackId = requireArguments().getString(ARG_RACK_ID);
        DraftRepository repository = DraftRepository.getInstance(requireContext());
        repository.hasDuplicate(scheduleId, rackId, barcode, duplicate -> {
            if (!duplicate) {
                save(DraftRules.DuplicateMode.REPLACE);
                return;
            }
            if (!canEditDraftItems()) {
                Toast.makeText(requireContext(), "Barcode sudah ada di rack. Item submitted tidak bisa diubah.", Toast.LENGTH_LONG).show();
                resetForNextScan();
                return;
            }
            new AlertDialog.Builder(requireContext())
                    .setTitle("Barcode sudah ada di rak")
                    .setMessage("Tambahkan quantity ke jumlah sekarang, atau ganti dengan quantity baru?")
                    .setPositiveButton("ADD", (dialog, which) -> save(DraftRules.DuplicateMode.ADD))
                    .setNegativeButton("REPLACE", (dialog, which) -> save(DraftRules.DuplicateMode.REPLACE))
                    .setNeutralButton("BATAL", null)
                    .show();
        });
    }

    private void save(DraftRules.DuplicateMode mode) {
        String barcode = barcodeInput.getText() == null ? "" : barcodeInput.getText().toString().trim();
        String scheduleId = requireArguments().getString(ARG_SCHEDULE_ID);
        String rackId = requireArguments().getString(ARG_RACK_ID);
        DraftRepository.getInstance(requireContext()).saveDraft(
                scheduleId,
                rackId,
                rackId,
                barcode,
                currentItem.plu,
                currentItem.pluDescription,
                quantity,
                "SCAN",
                mode,
                saved -> {
                    Toast.makeText(requireContext(), "Draft tersimpan lokal.", Toast.LENGTH_SHORT).show();
                    resetForNextScan();
                }
        );
    }

    private void showEditQuantityDialog(String scheduleId, String rackId, DraftRepository repository, LocalScanDraft draft) {
        if (!canEditDraftItems()) {
            Toast.makeText(requireContext(), "Rack sudah submitted. Item tidak bisa diedit.", Toast.LENGTH_LONG).show();
            return;
        }
        EditText input = new EditText(requireContext());
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setSelectAllOnFocus(true);
        input.setText(String.valueOf(draft.scanQty));
        input.setPadding(32, 8, 32, 8);
        new AlertDialog.Builder(requireContext())
                .setTitle("Edit quantity")
                .setMessage(draft.pluDescription)
                .setView(input)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Simpan", (dialog, which) -> {
                    int newQuantity;
                    try {
                        newQuantity = Math.max(1, Integer.parseInt(input.getText().toString().trim()));
                    } catch (RuntimeException ignored) {
                        Toast.makeText(requireContext(), "Quantity tidak valid.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    repository.updateQuantity(scheduleId, rackId, draft.id, newQuantity, new DraftRepository.ActionCallback() {
                        @Override
                        public void onSuccess() {
                            Toast.makeText(requireContext(), "Quantity diperbarui.", Toast.LENGTH_SHORT).show();
                        }

                        @Override
                        public void onError(String message) {
                            Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .show();
    }

    private void showDeleteDialog(String scheduleId, String rackId, DraftRepository repository, LocalScanDraft draft) {
        if (!canEditDraftItems()) {
            Toast.makeText(requireContext(), "Rack sudah submitted. Item tidak bisa dihapus.", Toast.LENGTH_LONG).show();
            return;
        }
        new AlertDialog.Builder(requireContext())
                .setTitle("Hapus item?")
                .setMessage(draft.pluDescription + "\nBarcode " + draft.barcode)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Hapus", (dialog, which) ->
                        repository.deleteDraft(scheduleId, rackId, draft.id, new DraftRepository.ActionCallback() {
                            @Override
                            public void onSuccess() {
                                Toast.makeText(requireContext(), "Item dihapus.", Toast.LENGTH_SHORT).show();
                            }

                            @Override
                            public void onError(String message) {
                                Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
                            }
                        }))
                .show();
    }

    private int readQuantity() {
        String raw = quantityInput.getText() == null ? "" : quantityInput.getText().toString().trim();
        try {
            return Math.max(1, Integer.parseInt(raw));
        } catch (RuntimeException ignored) {
            return 1;
        }
    }

    private Integer readPositiveQuantity() {
        String raw = quantityInput.getText() == null ? "" : quantityInput.getText().toString().trim();
        try {
            int parsed = Integer.parseInt(raw);
            return parsed > 0 ? parsed : null;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private void resetForNextScan() {
        quantity = 1;
        quantityInput.setText(String.valueOf(quantity));
        quantityInput.setError(null);
        barcodeInput.setText("");
        barcodeLayout.setError(null);
        currentItem = null;
        currentItemBarcode = null;
        lookupInFlight = false;
        barcodeInput.requestFocus();
    }

    private boolean isPendingDraft(LocalScanDraft draft) {
        return draft != null
                && ("DRAFT".equalsIgnoreCase(draft.syncStatus) || "ERROR".equalsIgnoreCase(draft.syncStatus));
    }

    private void refreshRackFromServer(DraftRepository repository, String scheduleId, String rackId, boolean userRefresh) {
        if (!userRefresh) {
            refreshLayout.setRefreshing(true);
        }
        repository.refreshRackFromServer(scheduleId, rackId, new DraftRepository.ActionCallback() {
            @Override
            public void onSuccess() {
                if (!isAdded()) {
                    return;
                }
                refreshLayout.setRefreshing(false);
                refreshRackPrintState(scheduleId, rackId);
                if (userRefresh) {
                    Toast.makeText(requireContext(), "Data rack diperbarui.", Toast.LENGTH_SHORT).show();
                }
                if (!rackPrinted) {
                    barcodeInput.requestFocus();
                }
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                refreshLayout.setRefreshing(false);
                Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
                if (!rackPrinted) {
                    barcodeInput.requestFocus();
                }
            }
        });
    }

    private void refreshRackPrintState(String scheduleId, String rackId) {
        NetworkRepository.getInstance(requireContext()).getRacks(scheduleId, new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<Rack> racks) {
                if (!isAdded() || racks == null) {
                    return;
                }
                for (Rack rack : racks) {
                    if (!rackId.equals(rack.id())) {
                        continue;
                    }
                    rackSubmitted = rack.submitted();
                    rackPrinted = rack.printed();
                    if (rackPrinted) {
                        ((MainActivity) requireActivity()).markActiveRackPrinted();
                        barcodeLayout.setError(null);
                    }
                    applyRackMode();
                    return;
                }
            }

            @Override
            public void onError(String message) {
                if (isAdded()) {
                    Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void updateScanSummary(List<LocalScanDraft> drafts) {
        int lines = drafts == null ? 0 : drafts.size();
        int qty = 0;
        if (drafts != null) {
            for (LocalScanDraft draft : drafts) {
                qty += draft.scanQty;
            }
        }
        scanSummary.setText(lines + " item  |  Qty " + qty);
        if (listHeader != null) {
            listHeader.setVisibility(lines > 0 || rackPrinted ? View.VISIBLE : View.GONE);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        String rackTitle = requireArguments().getString(ARG_RACK_TITLE, "Rack");
        ((MainActivity) requireActivity()).showBackNavigation(rackTitle);
    }

    @Override
    public void onDestroyView() {
        if (pendingLookup != null) {
            lookupHandler.removeCallbacks(pendingLookup);
        }
        super.onDestroyView();
    }
}
