package com.hero.stocktake.data.local;

import android.content.Context;

import androidx.room.Database;
import androidx.room.migration.Migration;
import androidx.room.Room;
import androidx.room.RoomDatabase;
import androidx.sqlite.db.SupportSQLiteDatabase;

import com.hero.stocktake.data.local.dao.ScanDraftDao;
import com.hero.stocktake.data.local.entity.LocalRack;
import com.hero.stocktake.data.local.entity.LocalScanDraft;
import com.hero.stocktake.data.local.entity.LocalSchedule;

@Database(
        entities = {LocalSchedule.class, LocalRack.class, LocalScanDraft.class},
        version = 4,
        exportSchema = false
)
public abstract class AppDatabase extends RoomDatabase {
    private static volatile AppDatabase instance;
    private static final Migration MIGRATION_3_4 = new Migration(3, 4) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            database.execSQL("ALTER TABLE local_scan_draft ADD COLUMN scannedAt INTEGER NOT NULL DEFAULT 0");
            database.execSQL("UPDATE local_scan_draft SET scannedAt = updatedAt WHERE scannedAt = 0");
        }
    };

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
                            .addMigrations(MIGRATION_3_4)
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
