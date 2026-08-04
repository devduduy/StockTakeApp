package com.hero.stocktake.data.local.entity;

import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

@Entity(
        tableName = "local_scan_draft",
        indices = @Index(value = {"scheduleId", "rackId", "barcode"}, unique = true)
)
public class LocalScanDraft {
    @PrimaryKey(autoGenerate = true)
    public long id;

    public String clientScanId;
    public String scheduleId;
    public String rackId;
    public String rackCode;
    public String barcode;
    public String plu;
    public String pluDescription;
    public int scanQty;
    public String inputType;
    public String syncStatus;
    public long scannedAt;
    public long updatedAt;

    public LocalScanDraft(
            String clientScanId,
            String scheduleId,
            String rackId,
            String rackCode,
            String barcode,
            String plu,
            String pluDescription,
            int scanQty,
            String inputType,
            String syncStatus,
            long scannedAt,
            long updatedAt
    ) {
        this.clientScanId = clientScanId;
        this.scheduleId = scheduleId;
        this.rackId = rackId;
        this.rackCode = rackCode;
        this.barcode = barcode;
        this.plu = plu;
        this.pluDescription = pluDescription;
        this.scanQty = scanQty;
        this.inputType = inputType;
        this.syncStatus = syncStatus;
        this.scannedAt = scannedAt;
        this.updatedAt = updatedAt;
    }
}
