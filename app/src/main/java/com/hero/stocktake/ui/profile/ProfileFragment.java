package com.hero.stocktake.ui.profile;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;

import com.hero.stocktake.R;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.ui.MainActivity;

import java.util.Locale;

public class ProfileFragment extends Fragment {
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_profile, container, false);
        SessionManager session = SessionManager.getInstance(requireContext());
        String fullName = valueOrDefault(session.getFullName(), "Scanner");
        String username = valueOrDefault(session.getUsername(), "scanner");
        String roleCode = valueOrDefault(session.getRoleCode(), "SCANNER");
        String locCode = valueOrDefault(session.getLocCode(), SessionManager.DEFAULT_LOC_CODE);

        ((TextView) view.findViewById(R.id.profileInitials)).setText(buildInitials(fullName));
        ((TextView) view.findViewById(R.id.profileFullName)).setText(fullName);
        ((TextView) view.findViewById(R.id.profileUsername)).setText("@" + username);
        ((TextView) view.findViewById(R.id.profileRole)).setText("Role: " + formatRole(roleCode));
        ((TextView) view.findViewById(R.id.profileLocation)).setText("Lokasi akses: " + locCode);
        ((TextView) view.findViewById(R.id.profileSession)).setText(session.hasAccessToken() ? "Sesi aktif" : "Sesi tidak aktif");

        view.findViewById(R.id.logoutButton).setOnClickListener(v -> confirmLogout());
        return view;
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showMenuNavigation("Profile");
    }

    private void confirmLogout() {
        new AlertDialog.Builder(requireContext())
                .setTitle("Logout?")
                .setMessage("User akan keluar dari aplikasi di device ini.")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Logout", (dialog, which) -> ((MainActivity) requireActivity()).logout())
                .show();
    }

    private String formatRole(String roleCode) {
        return roleCode.replace('_', ' ').toUpperCase(Locale.ROOT);
    }

    private String buildInitials(String name) {
        String[] parts = name.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) {
            return "SC";
        }
        String first = parts[0].substring(0, 1);
        String second = parts.length > 1 ? parts[1].substring(0, 1) : "";
        return (first + second).toUpperCase(Locale.ROOT);
    }

    private String valueOrDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }
}
