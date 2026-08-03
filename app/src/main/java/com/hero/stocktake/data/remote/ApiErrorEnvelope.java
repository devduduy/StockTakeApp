package com.hero.stocktake.data.remote;

public class ApiErrorEnvelope {
    public ApiError error;

    public static class ApiError {
        public String code;
        public String message;
    }
}
