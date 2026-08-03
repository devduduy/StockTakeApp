package com.hero.stocktake.data.local.entity;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "local_rack")
public class LocalRack {
    @PrimaryKey
    @NonNull
    public String id;
    public String rackCode;
    public String rackName;
    public String locCode;
    public String status;

    public LocalRack(@NonNull String id, String rackCode, String rackName, String locCode, String status) {
        this.id = id;
        this.rackCode = rackCode;
        this.rackName = rackName;
        this.locCode = locCode;
        this.status = status;
    }
}

