package com.hero.stocktake.ui.login;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.hero.stocktake.R;
import com.hero.stocktake.data.remote.dto.LoginResponseDto;
import com.hero.stocktake.data.repository.NetworkRepository;
import com.hero.stocktake.data.session.SessionExpiredHandler;
import com.hero.stocktake.data.session.SessionManager;
import com.hero.stocktake.ui.MainActivity;

public class LoginActivity extends AppCompatActivity {
    private MaterialButton loginButton;
    private TextInputLayout usernameLayout;
    private TextInputLayout passwordLayout;
    private TextInputEditText username;
    private TextInputEditText password;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (SessionManager.getInstance(this).hasAccessToken()) {
            openMain();
            return;
        }

        setContentView(R.layout.activity_login);
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.loginRoot), (view, insets) -> {
            Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            view.setPadding(view.getPaddingLeft(), statusBars.top, view.getPaddingRight(), view.getPaddingBottom());
            return insets;
        });

        usernameLayout = findViewById(R.id.usernameLayout);
        passwordLayout = findViewById(R.id.passwordLayout);
        username = findViewById(R.id.usernameInput);
        password = findViewById(R.id.passwordInput);
        loginButton = findViewById(R.id.loginButton);
        showSessionExpiredMessageIfNeeded();

        loginButton.setOnClickListener(view -> {
            usernameLayout.setError(null);
            passwordLayout.setError(null);
            String usernameValue = username.getText() == null ? "" : username.getText().toString().trim();
            String passwordValue = password.getText() == null ? "" : password.getText().toString();
            if (usernameValue.isEmpty()) {
                usernameLayout.setError("Username wajib diisi.");
                return;
            }
            if (passwordValue.isEmpty()) {
                passwordLayout.setError("Password wajib diisi.");
                return;
            }
            setLoading(true);
            NetworkRepository.getInstance(this).login(usernameValue, passwordValue, new NetworkRepository.ResultCallback<>() {
                @Override
                public void onSuccess(LoginResponseDto data) {
                    setLoading(false);
                    openMain();
                }

                @Override
                public void onError(String message) {
                    setLoading(false);
                    passwordLayout.setError(message);
                    Toast.makeText(LoginActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            });
        });
    }

    private void setLoading(boolean loading) {
        loginButton.setEnabled(!loading);
        username.setEnabled(!loading);
        password.setEnabled(!loading);
        loginButton.setText(loading ? "SIGNING IN..." : getString(R.string.login));
    }

    private void showSessionExpiredMessageIfNeeded() {
        String message = getIntent().getStringExtra(SessionExpiredHandler.EXTRA_SESSION_EXPIRED_MESSAGE);
        if (message != null && !message.trim().isEmpty()) {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        }
    }

    private void openMain() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
