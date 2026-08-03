package com.hero.stocktake.data.remote.dto;

import java.util.List;

public class ScheduleDto {
    public String id;
    public String scheduleNo;
    public String scheduleDesc;
    public String locCode;
    public LocationDto location;
    public String scheduleDate;
    public String startTime;
    public String endTime;
    public StockTypeDto stockType;
    public List<String> categoryIds;
    public List<CategoryDto> categories;
    public String status;
    public ProgressDto progress;

    public static class LocationDto {
        public String code;
        public String name;
    }

    public static class StockTypeDto {
        public int id;
        public String code;
        public String name;
        public String value;
    }

    public static class ProgressDto {
        public int totalRack;
        public int rackWithSubmittedScan;
        public int percentage;
    }

    public static class CategoryDto {
        public String id;
        public String name;
        public HierarchyDto department;
        public HierarchyDto division;
    }

    public static class HierarchyDto {
        public String id;
        public String name;
    }
}
