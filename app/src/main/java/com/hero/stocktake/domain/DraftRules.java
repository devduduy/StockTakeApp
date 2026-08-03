package com.hero.stocktake.domain;

public final class DraftRules {
    public enum DuplicateMode {
        ADD,
        REPLACE
    }

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

    public static int resolveQuantity(int currentQuantity, int incomingQuantity, DuplicateMode mode) {
        if (currentQuantity < 0 || incomingQuantity < 0) {
            throw new IllegalArgumentException("Quantity tidak boleh negatif.");
        }
        return mode == DuplicateMode.ADD ? currentQuantity + incomingQuantity : incomingQuantity;
    }
}

