package com.hero.stocktake.data.repository;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.lifecycle.LiveData;

import com.hero.stocktake.data.DummyData;
import com.hero.stocktake.data.local.AppDatabase;
import com.hero.stocktake.data.local.dao.ScanDraftDao;
import com.hero.stocktake.data.local.entity.LocalScanDraft;
import com.hero.stocktake.data.local.model.RackDraftSummary;
import com.hero.stocktake.data.remote.dto.RackScanDto;
import com.hero.stocktake.data.remote.dto.ScanSubmitLineDto;
import com.hero.stocktake.data.remote.dto.SubmitRackScansResponseDto;
import com.hero.stocktake.domain.DraftRules;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DraftRepository {
    public interface ResultCallback<T> {
        void onResult(T value);
    }

    public interface SubmitCallback {
        void onSuccess(int submittedLines);

        void onError(String message);
    }

    public interface ActionCallback {
        void onSuccess();

        void onError(String message);
    }

    private static volatile DraftRepository instance;
    private final Context appContext;
    private final ScanDraftDao dao;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private DraftRepository(Context context) {
        appContext = context.getApplicationContext();
        dao = AppDatabase.getInstance(context).scanDraftDao();
    }

    public static DraftRepository getInstance(Context context) {
        if (instance == null) {
            synchronized (DraftRepository.class) {
                if (instance == null) {
                    instance = new DraftRepository(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    public LiveData<List<LocalScanDraft>> observeRack(String scheduleId, String rackId) {
        return dao.observeRack(scheduleId, rackId);
    }

    public LiveData<List<RackDraftSummary>> observeScheduleSummary(String scheduleId) {
        return dao.observeScheduleSummary(scheduleId);
    }

    public LiveData<Integer> observePendingCount() {
        return dao.observePendingCount();
    }

    public void seedPrototypeDrafts() {
        executor.execute(() -> {
            if (dao.countForRack(DummyData.ACTIVE_SCHEDULE_ID, DummyData.ACTIVE_RACK_ID) > 0) {
                return;
            }
            long now = System.currentTimeMillis();
            dao.insert(new LocalScanDraft(
                    UUID.randomUUID().toString(),
                    DummyData.ACTIVE_SCHEDULE_ID,
                    DummyData.ACTIVE_RACK_ID,
                    "A1-02",
                    "8990123456789",
                    "100234",
                    "Apple Fuji 500g",
                    12,
                    "SCAN",
                    "DRAFT",
                    now,
                    now
            ));
            dao.insert(new LocalScanDraft(
                    UUID.randomUUID().toString(),
                    DummyData.ACTIVE_SCHEDULE_ID,
                    DummyData.ACTIVE_RACK_ID,
                    "A1-02",
                    "8994567890123",
                    "100245",
                    "Orange Navel",
                    24,
                    "MANUAL",
                    "DRAFT",
                    now - 1000,
                    now - 1000
            ));
        });
    }

    public void hasDuplicate(String scheduleId, String rackId, String barcode, ResultCallback<Boolean> callback) {
        executor.execute(() -> {
            boolean exists = dao.getByKey(scheduleId, rackId, barcode) != null;
            mainHandler.post(() -> callback.onResult(exists));
        });
    }

    public void isRackSubmitted(String scheduleId, String rackId, ResultCallback<Boolean> callback) {
        executor.execute(() -> {
            boolean submitted = dao.countSyncedForRack(scheduleId, rackId) > 0;
            mainHandler.post(() -> callback.onResult(submitted));
        });
    }

    public void saveDraft(
            String scheduleId,
            String rackId,
            String rackCode,
            String barcode,
            String plu,
            String description,
            int quantity,
            String inputType,
            DraftRules.DuplicateMode mode,
            ResultCallback<LocalScanDraft> callback
    ) {
        executor.execute(() -> {
            DraftRules.validate(barcode, quantity);
            LocalScanDraft existing = dao.getByKey(scheduleId, rackId, barcode);
            long now = System.currentTimeMillis();
            LocalScanDraft saved;
            if (existing == null) {
                saved = new LocalScanDraft(
                        UUID.randomUUID().toString(),
                        scheduleId,
                        rackId,
                        rackCode,
                        barcode,
                        plu,
                        description,
                        quantity,
                        inputType,
                        "DRAFT",
                        now,
                        now
                );
                saved.id = dao.insert(saved);
            } else {
                existing.scanQty = DraftRules.resolveQuantity(existing.scanQty, quantity, mode);
                existing.plu = plu;
                existing.pluDescription = description;
                existing.inputType = inputType;
                existing.syncStatus = "DRAFT";
                existing.scannedAt = now;
                existing.updatedAt = now;
                dao.update(existing);
                saved = existing;
            }
            LocalScanDraft result = saved;
            mainHandler.post(() -> callback.onResult(result));
        });
    }

    public void submitRack(String scheduleId, String rackId, SubmitCallback callback) {
        executor.execute(() -> {
            List<LocalScanDraft> submittable = dao.getSubmittableForRack(scheduleId, rackId);
            if (submittable.isEmpty()) {
                mainHandler.post(() -> callback.onSuccess(0));
                return;
            }
            List<String> clientScanIds = new ArrayList<>();
            List<ScanSubmitLineDto> lines = new ArrayList<>();
            for (LocalScanDraft draft : submittable) {
                if (draft.clientScanId == null || draft.clientScanId.trim().isEmpty()) {
                    draft.clientScanId = UUID.randomUUID().toString();
                    dao.update(draft);
                }
                clientScanIds.add(draft.clientScanId);
                lines.add(new ScanSubmitLineDto(
                        draft.clientScanId,
                        draft.barcode == null ? "" : draft.barcode,
                        draft.plu == null ? "" : draft.plu,
                        draft.pluDescription == null ? "" : draft.pluDescription,
                        draft.scanQty,
                        draft.inputType == null ? "SCAN" : draft.inputType,
                        draft.scannedAt
                ));
            }
            mainHandler.post(() -> NetworkRepository.getInstance(appContext).submitRackScans(
                    scheduleId,
                    rackId,
                    lines,
                    new NetworkRepository.ResultCallback<>() {
                        @Override
                        public void onSuccess(SubmitRackScansResponseDto data) {
                            executor.execute(() -> {
                                dao.markClientScansSynced(clientScanIds, System.currentTimeMillis());
                                mainHandler.post(() -> callback.onSuccess(data.acceptedLines));
                            });
                        }

                        @Override
                        public void onError(String message) {
                            callback.onError(message);
                        }
                    }
            ));
        });
    }

    public void refreshRackFromServer(String scheduleId, String rackId, ActionCallback callback) {
        NetworkRepository.getInstance(appContext).getRackScans(scheduleId, rackId, new NetworkRepository.ResultCallback<>() {
            @Override
            public void onSuccess(List<RackScanDto> scans) {
                executor.execute(() -> {
                    for (RackScanDto scan : scans) {
                        upsertSyncedScan(scheduleId, rackId, scan);
                    }
                    mainHandler.post(callback::onSuccess);
                });
            }

            @Override
            public void onError(String message) {
                callback.onError(message);
            }
        });
    }

    private void upsertSyncedScan(String scheduleId, String rackId, RackScanDto scan) {
        if (scan == null || scan.barcode == null || scan.barcode.trim().isEmpty()) {
            return;
        }
        String clientScanId = scan.clientScanId == null || scan.clientScanId.trim().isEmpty()
                ? "server-" + scan.id
                : scan.clientScanId;
        LocalScanDraft existing = dao.getByClientScanId(clientScanId);
        if (existing == null) {
            existing = dao.getByKey(scheduleId, rackId, scan.barcode);
        }
        long scannedAt = parseServerTime(scan.dateCreated);
        long updatedAt = parseServerTime(scan.dateModified == null ? scan.dateCreated : scan.dateModified);
        if (existing == null) {
            LocalScanDraft synced = new LocalScanDraft(
                    clientScanId,
                    scheduleId,
                    rackId,
                    rackId,
                    scan.barcode,
                    scan.plu,
                    scan.pluDescription,
                    scan.scanQty,
                    scan.inputType == null ? "SCAN" : scan.inputType,
                    "SYNCED",
                    scannedAt,
                    updatedAt
            );
            dao.insert(synced);
            return;
        }
        if ("DRAFT".equals(existing.syncStatus) || "ERROR".equals(existing.syncStatus)) {
            return;
        }
        existing.clientScanId = clientScanId;
        existing.plu = scan.plu;
        existing.pluDescription = scan.pluDescription;
        existing.scanQty = scan.scanQty;
        existing.inputType = scan.inputType == null ? "SCAN" : scan.inputType;
        existing.syncStatus = "SYNCED";
        existing.scannedAt = scannedAt;
        existing.updatedAt = updatedAt;
        dao.update(existing);
    }

    private long parseServerTime(String value) {
        if (value == null || value.trim().isEmpty()) {
            return System.currentTimeMillis();
        }
        try {
            return Instant.parse(value).toEpochMilli();
        } catch (DateTimeParseException ignored) {
            return System.currentTimeMillis();
        }
    }

    public void updateQuantity(String scheduleId, String rackId, long draftId, int quantity, ActionCallback callback) {
        executor.execute(() -> {
            if (dao.countSyncedForRack(scheduleId, rackId) > 0) {
                mainHandler.post(() -> callback.onError("Rack sudah submitted. Quantity tidak bisa diedit."));
                return;
            }
            if (quantity <= 0) {
                mainHandler.post(() -> callback.onError("Quantity harus lebih dari 0."));
                return;
            }
            int updated = dao.updateDraftQuantity(draftId, quantity, System.currentTimeMillis());
            if (updated <= 0) {
                mainHandler.post(() -> callback.onError("Item sudah submitted dan tidak bisa diedit."));
                return;
            }
            mainHandler.post(callback::onSuccess);
        });
    }

    public void deleteDraft(String scheduleId, String rackId, long draftId, ActionCallback callback) {
        executor.execute(() -> {
            if (dao.countSyncedForRack(scheduleId, rackId) > 0) {
                mainHandler.post(() -> callback.onError("Rack sudah submitted. Item tidak bisa dihapus."));
                return;
            }
            int deleted = dao.deleteDraft(draftId);
            if (deleted <= 0) {
                mainHandler.post(() -> callback.onError("Item sudah submitted dan tidak bisa dihapus."));
                return;
            }
            mainHandler.post(callback::onSuccess);
        });
    }
}
