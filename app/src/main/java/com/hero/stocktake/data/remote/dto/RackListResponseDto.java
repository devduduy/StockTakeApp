package com.hero.stocktake.data.remote.dto;

import java.util.List;

public class RackListResponseDto {
    public ScheduleLocationDto schedule;
    public List<RackDto> racks;

    public static class ScheduleLocationDto {
        public String id;
        public String scheduleNo;
        public String locCode;
        public String status;
    }
}
