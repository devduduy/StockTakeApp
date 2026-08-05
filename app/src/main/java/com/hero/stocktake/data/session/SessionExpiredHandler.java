package com.hero.stocktake.data.session;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.atomic.AtomicBoolean;

public final class SessionExpiredHandler {
    public static final String EXTRA_SESSION_EXPIRED_MESSAGE = "sessionExpiredMessage";
    private static final String LOGIN_ACTIVITY = "com.hero.stocktake.ui.login.LoginActivity";
    private static final String EXPIRED_MESSAGE = "Sesi login berakhir. Silakan login ulang.";
    private static final AtomicBoolean redirecting = new AtomicBoolean(false);

    private SessionExpiredHandler() {
    }

    public static void reset() {
        redirecting.set(false);
    }

    public static void handle(Context context) {
        Context appContext = context.getApplicationContext();
        SessionManager.getInstance(appContext).clear();
        if (!redirecting.compareAndSet(false, true)) {
            return;
        }

        new Handler(Looper.getMainLooper()).post(() -> {
            Intent intent = new Intent();
            intent.setClassName(appContext.getPackageName(), LOGIN_ACTIVITY);
            intent.putExtra(EXTRA_SESSION_EXPIRED_MESSAGE, EXPIRED_MESSAGE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            appContext.startActivity(intent);
        });
    }
}
