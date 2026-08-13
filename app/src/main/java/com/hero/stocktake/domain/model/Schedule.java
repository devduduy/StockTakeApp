package com.hero.stocktake.domain.model;

public record Schedule(
        String id,
        String number,
        String description,
        String locCode,
        String locationName,
        String startDate,
        String endDate,
        String scheduleDate,
        String scheduleTime,
        String stockTypeCode,
        String stockType,
        String categorySummary,
        String status,
        int progress,
        int scannedRacks,
        int totalRacks
) {
}
