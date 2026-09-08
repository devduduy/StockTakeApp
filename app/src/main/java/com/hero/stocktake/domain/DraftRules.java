package com.hero.stocktake.domain;

public final class DraftRules {
    private DraftRules() {
    }

    public static void validate(String barcode, int quantity) {
        if (barcode == null || barcode.trim().isEmpty()) {
            throw new IllegalArgumentException("Barcode wajib diisi.");
        }
        if (quantity < 0) {
            throw new IllegalArgumentException("Quantity tidak boleh negatif.");
        }
    }
}

