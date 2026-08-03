package com.hero.stocktake.ui.scanner;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.hero.stocktake.R;
import com.hero.stocktake.data.local.entity.LocalScanDraft;
import com.hero.stocktake.data.remote.dto.ItemLookupDto;
import com.hero.stocktake.data.repository.DraftRepository;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.domain.DraftRules;
import com.hero.stocktake.ui.MainActivity;
import com.hero.stocktake.ui.rack.ScanDraftAdapter;

import java.util.List;

public class ScannerFragment extends Fragment {
    private static final String ARG_SCHEDULE_ID = "scheduleId";
    private static final String ARG_RACK_ID = "rackId";

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
    private MaterialButton addButton;
    private MaterialButton submitButton;
    private List<LocalScanDraft> currentDrafts;
    private boolean submitting = false;
    private final Handler lookupHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingLookup;

    public static ScannerFragment newInstance(String scheduleId, String rackId) {
        ScannerFragment fragment = new ScannerFragment();
        Bundle args = new Bundle();
        args.putString(ARG_SCHEDULE_ID, scheduleId);
        args.putString(ARG_RACK_ID, rackId);
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
        addButton = view.findViewById(R.id.addButton);
        submitButton = view.findViewById(R.id.submitButton);
        barcodeLayout.setEndIconOnClickListener(v -> {
            barcodeInput.setText("");
            barcodeLayout.setError(null);
            barcodeInput.requestFocus();
        });
        String scheduleId = requireArguments().getString(ARG_SCHEDULE_ID);
        String rackId = requireArguments().getString(ARG_RACK_ID);
        DraftRepository repository = DraftRepository.getInstance(requireContext());
        ScanDraftAdapter draftAdapter = new ScanDraftAdapter();
        scannedItemList.setLayoutManager(new LinearLayoutManager(requireContext()));
        scannedItemList.setAdapter(draftAdapter);
        repository.observeRack(scheduleId, rackId).observe(getViewLifecycleOwner(), drafts -> {
            currentDrafts = drafts;
            draftAdapter.submitList(drafts);
            updateScanSummary(drafts);
            if (drafts != null && !drafts.isEmpty()) {
                scannedItemList.scrollToPosition(0);
            }
        });

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
        lookupBarcode(barcodeInput.getText() == null ? "" : barcodeInput.getText().toString());
        barcodeInput.requestFocus();
        barcodeInput.postDelayed(() -> {
            if (isAdded()) {
                barcodeInput.requestFocus();
            }
        }, 200);
        return view;
    }

    private void scheduleLookup(String rawBarcode) {
        if (pendingLookup != null) {
            lookupHandler.removeCallbacks(pendingLookup);
        }
        String barcode = rawBarcode == null ? "" : rawBarcode;
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
            submitButton.setEnabled(!submitting);
            submitButton.setText(submitting ? "Mengirim..." : "Submit");
        }
        if (addButton != null) {
            addButton.setEnabled(!submitting);
        }
        if (barcodeInput != null) {
            barcodeInput.setEnabled(!submitting);
        }
        if (quantityInput != null) {
            quantityInput.setEnabled(!submitting);
        }
    }

    private void lookupBarcode(String rawBarcode) {
        String barcode = rawBarcode == null ? "" : rawBarcode.trim();
        barcodeLayout.setError(null);
        currentItem = null;
        currentItemBarcode = null;
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
                currentItem = item;
                currentItemBarcode = barcode;
                productTitle.setText(item.pluDescription);
                pluText.setText("PLU\n" + item.plu);
                barcodeText.setText("Barcode\n" + barcode);
                validBadge.setText("Valid");
            }

            @Override
            public void onError(String message) {
                if (requestVersion != lookupRequestVersion) {
                    return;
                }
                productTitle.setText("Item tidak ditemukan");
                pluText.setText("PLU\n-");
                barcodeText.setText("Barcode\n" + barcode);
                validBadge.setText("Not Found");
                barcodeLayout.setError(message);
            }
        });
    }

    private void prepareSave() {
        String barcode = barcodeInput.getText() == null ? "" : barcodeInput.getText().toString().trim();
        quantity = readQuantity();
        try {
            DraftRules.validate(barcode, quantity);
        } catch (IllegalArgumentException error) {
            barcodeLayout.setError(error.getMessage());
            return;
        }
        if (currentItem == null || currentItemBarcode == null || !currentItemBarcode.equals(barcode)) {
            barcodeLayout.setError("Item belum valid. Tunggu lookup barcode selesai.");
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

    private int readQuantity() {
        String raw = quantityInput.getText() == null ? "" : quantityInput.getText().toString().trim();
        try {
            return Math.max(1, Integer.parseInt(raw));
        } catch (RuntimeException ignored) {
            return 1;
        }
    }

    private void resetForNextScan() {
        quantity = 1;
        quantityInput.setText(String.valueOf(quantity));
        barcodeInput.setText("");
        barcodeLayout.setError(null);
        currentItem = null;
        currentItemBarcode = null;
        barcodeInput.requestFocus();
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
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showBackNavigation("Scan Barcode");
    }

    @Override
    public void onDestroyView() {
        if (pendingLookup != null) {
            lookupHandler.removeCallbacks(pendingLookup);
        }
        super.onDestroyView();
    }
}
