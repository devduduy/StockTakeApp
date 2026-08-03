package com.hero.stocktake.data.remote;

import com.hero.stocktake.BuildConfig;

import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

public final class ApiClient {
    private static volatile StockTakeApi service;

    private ApiClient() {
    }

    public static StockTakeApi service() {
        if (service == null) {
            synchronized (ApiClient.class) {
                if (service == null) {
                    service = new Retrofit.Builder()
                            .baseUrl(BuildConfig.API_BASE_URL)
                            .addConverterFactory(GsonConverterFactory.create())
                            .build()
                            .create(StockTakeApi.class);
                }
            }
        }
        return service;
    }
}
