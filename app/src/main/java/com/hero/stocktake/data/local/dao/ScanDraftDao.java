package com.hero.stocktake.data.local.dao;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Update;

import com.hero.stocktake.data.local.entity.LocalScanDraft;
import com.hero.stocktake.data.local.model.RackDraftSummary;

import java.util.List;

@Dao
public interface ScanDraftDao {
    @Query("SELECT * FROM local_scan_draft WHERE scheduleId = :scheduleId AND rackId = :rackId ORDER BY updatedAt DESC")
    LiveData<List<LocalScanDraft>> observeRack(String scheduleId, String rackId);

    @Query("SELECT rackId, COUNT(*) AS itemCount, COALESCE(SUM(scanQty), 0) AS totalQuantity, SUM(CASE WHEN syncStatus IN ('DRAFT', 'ERROR') THEN 1 ELSE 0 END) AS pendingItemCount, COALESCE(SUM(CASE WHEN syncStatus IN ('DRAFT', 'ERROR') THEN scanQty ELSE 0 END), 0) AS pendingQuantity, MAX(updatedAt) AS lastUpdatedAt FROM local_scan_draft WHERE scheduleId = :scheduleId GROUP BY rackId")
    LiveData<List<RackDraftSummary>> observeScheduleSummary(String scheduleId);

    @Query("SELECT COUNT(*) FROM local_scan_draft WHERE syncStatus IN ('DRAFT', 'ERROR')")
    LiveData<Integer> observePendingCount();

    @Query("SELECT * FROM local_scan_draft WHERE scheduleId = :scheduleId AND rackId = :rackId AND barcode = :barcode LIMIT 1")
    LocalScanDraft getByKey(String scheduleId, String rackId, String barcode);

    @Query("SELECT * FROM local_scan_draft WHERE scheduleId = :scheduleId AND rackId = :rackId")
    List<LocalScanDraft> getSubmittableForRack(String scheduleId, String rackId);

    @Query("SELECT COUNT(*) FROM local_scan_draft WHERE scheduleId = :scheduleId AND rackId = :rackId")
    int countForRack(String scheduleId, String rackId);

    @Insert(onConflict = OnConflictStrategy.ABORT)
    long insert(LocalScanDraft draft);

    @Update
    void update(LocalScanDraft draft);

    @Query("UPDATE local_scan_draft SET syncStatus = 'SYNCED', updatedAt = :updatedAt WHERE scheduleId = :scheduleId AND rackId = :rackId AND syncStatus IN ('DRAFT', 'ERROR')")
    void markRackSynced(String scheduleId, String rackId, long updatedAt);

    @Query("UPDATE local_scan_draft SET syncStatus = 'SYNCED', updatedAt = :updatedAt WHERE clientScanId IN (:clientScanIds)")
    void markClientScansSynced(List<String> clientScanIds, long updatedAt);
}
