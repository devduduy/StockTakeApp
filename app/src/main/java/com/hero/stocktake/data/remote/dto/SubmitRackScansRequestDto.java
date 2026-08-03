package com.hero.stocktake.data.remote.dto;

import java.util.List;

public class SubmitRackScansRequestDto {
    public final List<ScanSubmitLineDto> lines;

    public SubmitRackScansRequestDto(List<ScanSubmitLineDto> lines) {
        this.lines = lines;
    }
}
