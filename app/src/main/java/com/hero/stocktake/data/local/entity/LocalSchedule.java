package com.hero.stocktake.data.local.entity;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "local_schedule")
public class LocalSchedule {
    @PrimaryKey
    @NonNull
    public String id;
    public String scheduleNo;
    public String description;
    public String locCode;
    public String status;

    public LocalSchedule(@NonNull String id, String scheduleNo, String description, String locCode, String status) {
        this.id = id;
        this.scheduleNo = scheduleNo;
        this.description = description;
        this.locCode = locCode;
        this.status = status;
    }
}

