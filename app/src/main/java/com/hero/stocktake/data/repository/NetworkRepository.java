package com.hero.stocktake.data.repository;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.gson.Gson;
import com.hero.stocktake.data.remote.ApiClient;
import com.hero.stocktake.data.remote.ApiEnvelope;
import com.hero.stocktake.data.remote.ApiErrorEnvelope;
import com.hero.stocktake.data.remote.StockTakeApi;
import com.hero.stocktake.data.remote.dto.ItemLookupDto;
import com.hero.stocktake.data.remote.dto.LoginRequestDto;
import com.hero.stocktake.data.remote.dto.LoginResponseDto;
import com.hero.stocktake.data.remote.dto.RackDto;
import com.hero.stocktake.data.remote.dto.RackListResponseDto;
import com.hero.stocktake.data.remote.dto.ScanSubmitLineDto;
import com.hero.stocktake.data.remote.dto.ScheduleDto;
import com.hero.stocktake.data.remote.dto.SubmitRackScansRequestDto;
import com.hero.stocktake.data.remote.dto.SubmitRackScansResponseDto;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.domain.model.Rack;
import com.hero.stocktake.domain.model.Schedule;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class NetworkRepository {
    private static volatile NetworkRepository instance;

    private final StockTakeApi api;
    private final SessionManager sessionManager;
    private final Gson gson = new Gson();

    private NetworkRepository(Context context) {
        api = ApiClient.service();
        sessionManager = SessionManager.getInstance(context);
    }

    public static NetworkRepository getInstance(Context context) {
        if (instance == null) {
            synchronized (NetworkRepository.class) {
                if (instance == null) {
                    instance = new NetworkRepository(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    public void login(String username, String password, ResultCallback<LoginResponseDto> callback) {
        api.login(new LoginRequestDto(username, password)).enqueue(new Callback<>() {
            @Override
            public void onResponse(@NonNull Call<ApiEnvelope<LoginResponseDto>> call, @NonNull Response<ApiEnvelope<LoginResponseDto>> response) {
                ApiEnvelope<LoginResponseDto> envelope = response.body();
                if (response.isSuccessful() && envelope != null && envelope.data != null) {
                    LoginResponseDto.UserDto user = envelope.data.user;
                    String roleCode = user != null && user.role != null ? user.role.code : "SCANNER";
                    sessionManager.saveLogin(
                            envelope.data.accessToken,
                            user == null ? username : user.username,
                            user == null ? username : user.fullName,
                            roleCode,
                            user == null ? SessionManager.DEFAULT_LOC_CODE : user.locCode
                    );
                    callback.onSuccess(envelope.data);
                    return;
                }
                callback.onError(readError(response, "Login gagal."));
            }

            @Override
            public void onFailure(@NonNull Call<ApiEnvelope<LoginResponseDto>> call, @NonNull Throwable throwable) {
                callback.onError(networkError(throwable));
            }
        });
    }

    public void getActiveSchedules(ResultCallback<List<Schedule>> callback) {
        String authorization = sessionManager.getAuthorizationHeader();
        if (authorization == null) {
            callback.onError("Sesi login tidak ditemukan. Silakan login ulang.");
            return;
        }
        api.activeSchedules(authorization, sessionManager.getLocCode()).enqueue(new Callback<>() {
            @Override
            public void onResponse(@NonNull Call<ApiEnvelope<List<ScheduleDto>>> call, @NonNull Response<ApiEnvelope<List<ScheduleDto>>> response) {
                ApiEnvelope<List<ScheduleDto>> envelope = response.body();
                if (response.isSuccessful() && envelope != null && envelope.data != null) {
                    List<Schedule> schedules = new ArrayList<>();
                    for (ScheduleDto dto : envelope.data) {
                        schedules.add(mapSchedule(dto));
                    }
                    callback.onSuccess(schedules);
                    return;
                }
                callback.onError(readError(response, "Gagal memuat active schedule."));
            }

            @Override
            public void onFailure(@NonNull Call<ApiEnvelope<List<ScheduleDto>>> call, @NonNull Throwable throwable) {
                callback.onError(networkError(throwable));
            }
        });
    }

    public void getRacks(String scheduleId, ResultCallback<List<Rack>> callback) {
        String authorization = sessionManager.getAuthorizationHeader();
        if (authorization == null) {
            callback.onError("Sesi login tidak ditemukan. Silakan login ulang.");
            return;
        }
        api.racks(authorization, scheduleId).enqueue(new Callback<>() {
            @Override
            public void onResponse(@NonNull Call<ApiEnvelope<RackListResponseDto>> call, @NonNull Response<ApiEnvelope<RackListResponseDto>> response) {
                ApiEnvelope<RackListResponseDto> envelope = response.body();
                if (response.isSuccessful() && envelope != null && envelope.data != null && envelope.data.racks != null) {
                    List<Rack> racks = new ArrayList<>();
                    for (RackDto dto : envelope.data.racks) {
                        racks.add(mapRack(dto));
                    }
                    callback.onSuccess(racks);
                    return;
                }
                callback.onError(readError(response, "Gagal memuat rack list."));
            }

            @Override
            public void onFailure(@NonNull Call<ApiEnvelope<RackListResponseDto>> call, @NonNull Throwable throwable) {
                callback.onError(networkError(throwable));
            }
        });
    }

    public void lookupItem(String barcode, String scheduleId, ResultCallback<ItemLookupDto> callback) {
        String authorization = sessionManager.getAuthorizationHeader();
        if (authorization == null) {
            callback.onError("Sesi login tidak ditemukan. Silakan login ulang.");
            return;
        }
        api.lookupItem(authorization, barcode, scheduleId).enqueue(new Callback<>() {
            @Override
            public void onResponse(@NonNull Call<ApiEnvelope<ItemLookupDto>> call, @NonNull Response<ApiEnvelope<ItemLookupDto>> response) {
                ApiEnvelope<ItemLookupDto> envelope = response.body();
                if (response.isSuccessful() && envelope != null && envelope.data != null) {
                    callback.onSuccess(envelope.data);
                    return;
                }
                callback.onError(readError(response, "Barcode tidak ditemukan."));
            }

            @Override
            public void onFailure(@NonNull Call<ApiEnvelope<ItemLookupDto>> call, @NonNull Throwable throwable) {
                callback.onError(networkError(throwable));
            }
        });
    }

    public void submitRackScans(
            String scheduleId,
            String rackId,
            List<ScanSubmitLineDto> lines,
            ResultCallback<SubmitRackScansResponseDto> callback
    ) {
        String authorization = sessionManager.getAuthorizationHeader();
        if (authorization == null) {
            callback.onError("Sesi login tidak ditemukan. Silakan login ulang.");
            return;
        }
        api.submitRackScans(authorization, scheduleId, rackId, new SubmitRackScansRequestDto(lines)).enqueue(new Callback<>() {
            @Override
            public void onResponse(@NonNull Call<ApiEnvelope<SubmitRackScansResponseDto>> call, @NonNull Response<ApiEnvelope<SubmitRackScansResponseDto>> response) {
                ApiEnvelope<SubmitRackScansResponseDto> envelope = response.body();
                if (response.isSuccessful() && envelope != null && envelope.data != null) {
                    callback.onSuccess(envelope.data);
                    return;
                }
                callback.onError(readError(response, "Gagal submit hasil scan."));
            }

            @Override
            public void onFailure(@NonNull Call<ApiEnvelope<SubmitRackScansResponseDto>> call, @NonNull Throwable throwable) {
                callback.onError(networkError(throwable));
            }
        });
    }

    private Schedule mapSchedule(ScheduleDto dto) {
        int totalRacks = dto.progress == null ? 0 : dto.progress.totalRack;
        int scannedRacks = dto.progress == null ? 0 : dto.progress.rackWithSubmittedScan;
        int progress = dto.progress == null ? 0 : dto.progress.percentage;
        String stockType = dto.stockType == null ? dto.scheduleDesc : dto.stockType.name;
        String stockTypeCode = dto.stockType == null ? "" : dto.stockType.code;
        String locCode = firstNonBlank(dto.locCode, dto.location == null ? null : dto.location.code, "-");
        String locationName = firstNonBlank(dto.location == null ? null : dto.location.name, locCode);
        return new Schedule(
                dto.id,
                dto.scheduleNo,
                firstNonBlank(dto.scheduleDesc, "Stock Take"),
                locCode,
                locationName,
                displayDate(dto.scheduleDate),
                displayTimeRange(dto.startTime, dto.endTime),
                stockTypeCode,
                stockType == null || stockType.trim().isEmpty() ? "Stock Take" : stockType,
                categorySummary(dto),
                displayStatus(dto.status),
                progress,
                scannedRacks,
                totalRacks
        );
    }

    private Rack mapRack(RackDto dto) {
        String lastScan = dto.submittedLineCount > 0 ? "Submitted" : "Belum ada";
        return new Rack(
                dto.id,
                dto.rackCode,
                dto.rackName,
                displayStatus(dto.status),
                dto.localDraftCount + dto.submittedLineCount,
                dto.submittedQuantity,
                lastScan
        );
    }

    private String displayStatus(String status) {
        if (status == null || status.trim().isEmpty()) {
            return "-";
        }
        return status.replace('_', ' ').toUpperCase(Locale.ROOT);
    }

    private String categorySummary(ScheduleDto dto) {
        String stockType = dto.stockType == null ? "" : firstNonBlank(dto.stockType.name, dto.stockType.value, "");
        if ("ALL".equalsIgnoreCase(stockType) || dto.categories == null || dto.categories.isEmpty()) {
            return "Semua category";
        }
        StringBuilder builder = new StringBuilder();
        int shown = Math.min(dto.categories.size(), 2);
        for (int i = 0; i < shown; i++) {
            if (i > 0) {
                builder.append(", ");
            }
            builder.append(firstNonBlank(dto.categories.get(i).name, dto.categories.get(i).id));
        }
        if (dto.categories.size() > shown) {
            builder.append(" +").append(dto.categories.size() - shown);
        }
        return builder.toString();
    }

    private String displayDate(String value) {
        if (value == null || value.length() < 10) {
            return "-";
        }
        String[] months = {"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"};
        try {
            int month = Integer.parseInt(value.substring(5, 7));
            return value.substring(8, 10) + " " + months[Math.max(0, Math.min(11, month - 1))] + " " + value.substring(0, 4);
        } catch (RuntimeException ignored) {
            return value.substring(0, 10);
        }
    }

    private String displayTimeRange(String start, String end) {
        String startText = displayTime(start);
        String endText = displayTime(end);
        if ("-".equals(startText) && "-".equals(endText)) {
            return "Jam belum ditentukan";
        }
        if ("-".equals(endText)) {
            return startText + " - selesai";
        }
        return startText + " - " + endText;
    }

    private String displayTime(String value) {
        if (value == null || value.trim().isEmpty()) {
            return "-";
        }
        int marker = value.indexOf('T');
        if (marker >= 0 && value.length() >= marker + 6) {
            return value.substring(marker + 1, marker + 6);
        }
        if (value.length() >= 5) {
            return value.substring(0, 5);
        }
        return value;
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return "";
    }

    private String readError(Response<?> response, String fallback) {
        ResponseBody errorBody = response.errorBody();
        if (errorBody == null) {
            return fallback;
        }
        try {
            ApiErrorEnvelope envelope = gson.fromJson(errorBody.string(), ApiErrorEnvelope.class);
            if (envelope != null && envelope.error != null && envelope.error.message != null) {
                return envelope.error.message;
            }
        } catch (IOException | RuntimeException ignored) {
            return fallback;
        }
        return fallback;
    }

    private String networkError(Throwable throwable) {
        String message = throwable.getMessage();
        if (message == null || message.trim().isEmpty()) {
            return "Tidak bisa terhubung ke backend.";
        }
        return "Tidak bisa terhubung ke backend: " + message;
    }

    public interface ResultCallback<T> {
        void onSuccess(T data);

        void onError(String message);
    }
}
