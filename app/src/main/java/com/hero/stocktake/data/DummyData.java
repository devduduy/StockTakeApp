package com.hero.stocktake.data;

import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.domain.model.Schedule;

import java.util.List;

public final class DummyData {
    public static final String ACTIVE_SCHEDULE_ID = "ST20260731001";
    public static final String ACTIVE_RACK_ID = "A1-02";

    private DummyData() {
    }

    public static List<Schedule> schedules() {
        return List.of(
                new Schedule(ACTIVE_SCHEDULE_ID, "ST/2026/07/0001", "Fresh Food cycle count", "6168", "HERO 6168", "2026-07-31", "2026-07-31", "31 Jul 2026", "08:00 - 18:00", "STOCK_PARTIAL", "PARTIAL", "Fresh Food", "IN PROGRESS", 68, 150, 220),
                new Schedule("ST20260731002", "ST/2026/07/0002", "Daily full stock opname", "6168", "HERO 6168", "2026-07-31", "2026-07-31", "31 Jul 2026", "09:00 - 20:00", "STOCK_ALL", "ALL", "Semua category", "IN PROGRESS", 32, 45, 140),
                new Schedule("ST20260801001", "ST/2026/08/0001", "Frozen follow-up", "6168", "HERO 6168", "2026-08-01", "2026-08-01", "01 Aug 2026", "08:00 - selesai", "STOCK_PARTIAL", "PARTIAL", "Dairy & Frozen", "OPEN", 0, 0, 85),
                new Schedule("ST20260801002", "ST/2026/08/0002", "Seasonal aisle", "6168", "HERO 6168", "2026-08-01", "2026-08-01", "01 Aug 2026", "08:00 - selesai", "STOCK_PARTIAL", "PARTIAL", "Apparel", "OPEN", 0, 0, 42)
        );
    }

    public static List<Rack> racks() {
        return List.of(
                new Rack("A1-01", "RCK-FF-A101", "Rack A1-01", "SUBMITTED", 42, 78, "10:45", true, false),
                new Rack(ACTIVE_RACK_ID, "RCK-FF-A102", "Rack A1-02", "IN PROGRESS", 2, 36, "Active now", false, false),
                new Rack("A1-03", "RCK-FF-A103", "Rack A1-03", "NOT STARTED", 0, 0, "-", false, false)
        );
    }
}
