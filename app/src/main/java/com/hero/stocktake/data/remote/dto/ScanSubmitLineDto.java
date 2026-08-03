package com.hero.stocktake.data.remote.dto;

public class ScanSubmitLineDto {
    public final String clientScanId;
    public final String barcode;
    public final String plu;
    public final String pluDescription;
    public final int scanQty;
    public final String inputType;
    public final long clientUpdatedAt;

    public ScanSubmitLineDto(
            String clientScanId,
            String barcode,
            String plu,
            String pluDescription,
            int scanQty,
            String inputType,
            long clientUpdatedAt
    ) {
        this.clientScanId = clientScanId;
        this.barcode = barcode;
        this.plu = plu;
        this.pluDescription = pluDescription;
        this.scanQty = scanQty;
        this.inputType = inputType;
        this.clientUpdatedAt = clientUpdatedAt;
    }
}
