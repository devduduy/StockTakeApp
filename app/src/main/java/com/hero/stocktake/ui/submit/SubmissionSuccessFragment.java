package com.hero.stocktake.ui.submit;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.hero.stocktake.R;
import com.hero.stocktake.ui.MainActivity;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class SubmissionSuccessFragment extends Fragment {
    private static final String ARG_LINES = "lines";

    public static SubmissionSuccessFragment newInstance(int lines) {
        SubmissionSuccessFragment fragment = new SubmissionSuccessFragment();
        Bundle args = new Bundle();
        args.putInt(ARG_LINES, lines);
        fragment.setArguments(args);
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_submission_success, container, false);
        int lines = requireArguments().getInt(ARG_LINES, 0);
        TextView submittedLines = view.findViewById(R.id.submittedLines);
        TextView submittedTime = view.findViewById(R.id.submittedTime);
        submittedLines.setText("Item terkirim: " + lines);
        submittedTime.setText("Waktu submit: " + new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date()));
        view.findViewById(R.id.backToRackListButton).setOnClickListener(v -> ((MainActivity) requireActivity()).returnToRackList());
        return view;
    }

    @Override
    public void onResume() {
        super.onResume();
        ((MainActivity) requireActivity()).showBackNavigation("Submit Berhasil");
    }
}
