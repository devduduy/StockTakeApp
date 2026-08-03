package com.hero.stocktake.domain.model;

public record Rack(
        String id,
        String code,
        String name,
        String status,
        int itemCount,
        int totalQuantity,
        String lastScan
) {
}
