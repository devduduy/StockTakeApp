package com.hero.stocktake.ui.dashboard;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.hero.stocktake.R;
import com.hero.stocktake.data.repository.DraftRepository;
import com.hero.stocktake.ui.MainActivity;

public class DashboardFragment extends Fragment {
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_dashboard, container, false);
        TextView pendingCount = view.findViewById(R.id.pendingDraftCount);

        DraftRepository.getInstance(requireContext())
                .observePendingCount()
                .observe(getViewLifecycleOwner(), count -> pendingCount.setText(String.valueOf(count == null ? 0 : count)));

        view.findViewById(R.id.startButton).setOnClickListener(v -> ((MainActivity) requireActivity()).openSchedules());
        view.findViewById(R.id.continueButton).setOnClickListener(v -> ((MainActivity) requireActivity()).openRackDetail());
        return view;
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showMenuNavigation("Dashboard");
    }
}
