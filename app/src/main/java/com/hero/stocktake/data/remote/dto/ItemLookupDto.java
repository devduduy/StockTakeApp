package com.hero.stocktake.data.remote.dto;

public class ItemLookupDto {
    public String barcode;
    public String plu;
    public String pluDescription;
    public CategoryDto category;
    public double erpQty;
    public String source;

    public static class CategoryDto {
        public String id;
        public String name;
    }
}
