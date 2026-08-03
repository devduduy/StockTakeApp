package com.hero.stocktake.data.local;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

import com.hero.stocktake.data.local.dao.ScanDraftDao;
import com.hero.stocktake.data.local.entity.LocalRack;
import com.hero.stocktake.data.local.entity.LocalScanDraft;
import com.hero.stocktake.data.local.entity.LocalSchedule;

@Database(
        entities = {LocalSchedule.class, LocalRack.class, LocalScanDraft.class},
        version = 3,
        exportSchema = false
)
public abstract class AppDatabase extends RoomDatabase {
    private static volatile AppDatabase instance;

    public abstract ScanDraftDao scanDraftDao();

    public static AppDatabase getInstance(Context context) {
        if (instance == null) {
            synchronized (AppDatabase.class) {
                if (instance == null) {
                    instance = Room.databaseBuilder(
                            context.getApplicationContext(),
                            AppDatabase.class,
                            "hero-stocktake.db"
                    )
                            // Prototype only: schema lama belum menyimpan data server-authoritative.
                            // Jika schema berubah, draft lokal lama boleh dibuat ulang agar app tidak force close.
                            .fallbackToDestructiveMigration(true)
                            .build();
                }
            }
        }
        return instance;
    }
}
