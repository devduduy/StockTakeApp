package com.hero.stocktake.data.remote.dto;

public class LoginResponseDto {
    public String accessToken;
    public String tokenType;
    public String expiresIn;
    public UserDto user;

    public static class UserDto {
        public String id;
        public String username;
        public String fullName;
        public RoleDto role;
        public String locCode;
        public String status;
    }

    public static class RoleDto {
        public int id;
        public String code;
        public String name;
    }
}
