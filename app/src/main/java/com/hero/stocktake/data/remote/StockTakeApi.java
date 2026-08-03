package com.hero.stocktake.data.remote;

import com.hero.stocktake.data.remote.dto.LoginRequestDto;
import com.hero.stocktake.data.remote.dto.LoginResponseDto;
import com.hero.stocktake.data.remote.dto.ItemLookupDto;
import com.hero.stocktake.data.remote.dto.RackDto;
import com.hero.stocktake.data.remote.dto.RackListResponseDto;
import com.hero.stocktake.data.remote.dto.ScheduleDto;
import com.hero.stocktake.data.remote.dto.SubmitRackScansRequestDto;
import com.hero.stocktake.data.remote.dto.SubmitRackScansResponseDto;

import java.util.List;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.POST;
import retrofit2.http.Path;
import retrofit2.http.Query;

public interface StockTakeApi {
    @POST("api/auth/login")
    Call<ApiEnvelope<LoginResponseDto>> login(@Body LoginRequestDto body);

    @GET("api/stock-take/schedules/active")
    Call<ApiEnvelope<List<ScheduleDto>>> activeSchedules(
            @Header("Authorization") String authorization,
            @Query("locCode") String locCode
    );

    @GET("api/stock-take/schedules/{scheduleId}/racks")
    Call<ApiEnvelope<RackListResponseDto>> racks(
            @Header("Authorization") String authorization,
            @Path("scheduleId") String scheduleId
    );

    @GET("api/stock-take/items/lookup")
    Call<ApiEnvelope<ItemLookupDto>> lookupItem(
            @Header("Authorization") String authorization,
            @Query("barcode") String barcode,
            @Query("scheduleId") String scheduleId
    );

    @POST("api/stock-take/schedules/{scheduleId}/racks/{rackId}/scans/submit")
    Call<ApiEnvelope<SubmitRackScansResponseDto>> submitRackScans(
            @Header("Authorization") String authorization,
            @Path("scheduleId") String scheduleId,
            @Path("rackId") String rackId,
            @Body SubmitRackScansRequestDto body
    );
}
