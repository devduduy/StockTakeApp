package com.hero.stocktake.data.session;

import android.content.Context;
import android.content.SharedPreferences;

public class SessionManager {
    public static final String DEFAULT_LOC_CODE = "6168";

    private static final String PREFS_NAME = "hero_stocktake_session";
    private static final String KEY_ACCESS_TOKEN = "accessToken";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_FULL_NAME = "fullName";
    private static final String KEY_ROLE_CODE = "roleCode";
    private static final String KEY_LOC_CODE = "locCode";

    private static volatile SessionManager instance;

    private final SharedPreferences preferences;

    private SessionManager(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static SessionManager getInstance(Context context) {
        if (instance == null) {
            synchronized (SessionManager.class) {
                if (instance == null) {
                    instance = new SessionManager(context);
                }
            }
        }
        return instance;
    }

    public void saveLogin(String accessToken, String username, String fullName, String roleCode, String locCode) {
        SessionExpiredHandler.reset();
        preferences.edit()
                .putString(KEY_ACCESS_TOKEN, accessToken)
                .putString(KEY_USERNAME, username)
                .putString(KEY_FULL_NAME, fullName)
                .putString(KEY_ROLE_CODE, roleCode)
                .putString(KEY_LOC_CODE, locCode == null || locCode.trim().isEmpty() ? DEFAULT_LOC_CODE : locCode.trim())
                .apply();
    }

    public boolean hasAccessToken() {
        String token = getAccessToken();
        return token != null && !token.trim().isEmpty();
    }

    public String getAccessToken() {
        return preferences.getString(KEY_ACCESS_TOKEN, null);
    }

    public String getAuthorizationHeader() {
        String token = getAccessToken();
        return token == null || token.trim().isEmpty() ? null : "Bearer " + token;
    }

    public String getLocCode() {
        return preferences.getString(KEY_LOC_CODE, DEFAULT_LOC_CODE);
    }

    public String getUsername() {
        return preferences.getString(KEY_USERNAME, "scanner");
    }

    public String getFullName() {
        return preferences.getString(KEY_FULL_NAME, "Scanner");
    }

    public String getRoleCode() {
        return preferences.getString(KEY_ROLE_CODE, "SCANNER");
    }

    public String getProfileLabel() {
        return getFullName() + " - " + getRoleCode();
    }

    public void clear() {
        preferences.edit().clear().apply();
    }
}
