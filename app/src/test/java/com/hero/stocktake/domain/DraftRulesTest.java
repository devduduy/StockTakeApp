package com.hero.stocktake.domain;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class DraftRulesTest {
    @Test
    public void addModeAccumulatesQuantity() {
        assertEquals(7, DraftRules.resolveQuantity(5, 2, DraftRules.DuplicateMode.ADD));
    }

    @Test
    public void replaceModeUsesIncomingQuantity() {
        assertEquals(2, DraftRules.resolveQuantity(5, 2, DraftRules.DuplicateMode.REPLACE));
    }

    @Test
    public void negativeQuantityIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> DraftRules.validate("8990001", -1));
    }

    @Test
    public void blankBarcodeIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> DraftRules.validate(" ", 1));
    }
}

