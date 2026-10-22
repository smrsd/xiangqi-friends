package io.xiangqifriends.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** A deliberately small native client. Accounts and game state belong to the server. */
public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(23, 63, 50);
    private static final int PAPER = Color.rgb(244, 241, 233);
    private static final int MUTED = Color.rgb(98, 112, 105);
    private SharedPreferences preferences;
    private LinearLayout root;
    private LinearLayout setup;
    private ScrollView setupScroll;
    private LinearLayout game;
    private FrameLayout webFrame;
    private LinearLayout errorPanel;
    private TextView errorMessage;
    private ProgressBar progress;
    private EditText serverInput;
    private Button connectButton;
    private WebView webView;
    private Uri serverOrigin;
    private boolean pageFailed;
    private boolean showingSetup;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        preferences = getSharedPreferences("xiangqifriends", MODE_PRIVATE);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(INK);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);
        createSetup();
        createGame();
        String saved = preferences.getString("server", BuildConfig.DEFAULT_SERVER_URL);
        serverInput.setText(saved);
        try {
            if (!saved.isEmpty()) serverOrigin = Uri.parse(ServerAddress.normalize(saved, BuildConfig.DEBUG));
        } catch (IllegalArgumentException ignored) {
            preferences.edit().remove("server").apply();
        }
        if (serverOrigin == null) {
            showSetup();
        } else {
            showGame();
            ensureWebView();
            if (state == null || webView.restoreState(state) == null) loadHome();
            if (state != null && state.getBoolean("showingSetup", false)) showSetup();
        }
    }

    private void createSetup() {
        setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        setup.setGravity(Gravity.CENTER_VERTICAL);
        setup.setPadding(dp(26), dp(20), dp(26), dp(20));
        setup.setBackgroundColor(PAPER);
        TextView mark = text("帥", 62, INK);
        setup.addView(mark);
        TextView title = text("棋友中国象棋", 30, INK);
        setup.addView(title);
        TextView intro = text("和朋友坐一桌，随时来一局。", 16, MUTED);
        pad(intro, 12, 28);
        setup.addView(intro);
        setup.addView(text("游戏服务器地址", 14, INK));
        serverInput = new EditText(this);
        serverInput.setSingleLine(true);
        serverInput.setTextSize(16);
        serverInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        serverInput.setHint("https://你的游戏网址/");
        serverInput.setTextColor(INK);
        setup.addView(serverInput, new LinearLayout.LayoutParams(-1, dp(56)));
        TextView hint = text("填写部署后的 HTTPS 网址。注册、好友和棋局在该服务器中同步。", 13, MUTED);
        pad(hint, 12, 20);
        setup.addView(hint);
        connectButton = button("保存并进入棋室", view -> connect());
        setup.addView(connectButton, new LinearLayout.LayoutParams(-1, dp(52)));
        TextView privacy = text("地址保存在本机。登录凭证由网页管理；关闭应用进程后需要重新登录。", 12, MUTED);
        pad(privacy, 24, 0);
        setup.addView(privacy);
        setupScroll = new ScrollView(this);
        setupScroll.setFillViewport(true);
        setupScroll.setBackgroundColor(PAPER);
        setupScroll.addView(setup, new ScrollView.LayoutParams(-1, -1));
        root.addView(setupScroll, new LinearLayout.LayoutParams(-1, -1));
    }

    private void createGame() {
        game = new LinearLayout(this);
        game.setOrientation(LinearLayout.VERTICAL);
        game.setBackgroundColor(PAPER);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), 0, dp(8), 0);
        bar.setBackgroundColor(INK);
        TextView title = text("帥  棋友中国象棋", 16, Color.WHITE);
        bar.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
        title.setGravity(Gravity.CENTER_VERTICAL);
        Button reload = button("刷新", view -> loadHome());
        Button settings = button("地址", view -> showSetup());
        bar.addView(reload, new LinearLayout.LayoutParams(dp(64), dp(44)));
        bar.addView(settings, new LinearLayout.LayoutParams(dp(64), dp(44)));
        game.addView(bar, new LinearLayout.LayoutParams(-1, dp(48)));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(220, 180, 83)));
        game.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        webFrame = new FrameLayout(this);
        game.addView(webFrame, new LinearLayout.LayoutParams(-1, 0, 1));
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(24), dp(28), dp(24));
        errorPanel.setBackgroundColor(PAPER);
        TextView titleError = text("暂时没连上棋室", 24, INK);
        titleError.setGravity(Gravity.CENTER);
        errorPanel.addView(titleError);
        errorMessage = text("请检查网络后重试。", 15, MUTED);
        errorMessage.setGravity(Gravity.CENTER);
        pad(errorMessage, 18, 24);
        errorPanel.addView(errorMessage);
        errorPanel.addView(button("重新连接", view -> loadHome()));
        errorPanel.addView(button("修改服务器地址", view -> showSetup()));
        webFrame.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        errorPanel.setVisibility(View.GONE);
        root.addView(game, new LinearLayout.LayoutParams(-1, -1));
    }

    private void ensureWebView() {
        if (webView != null) return;
        webView = new WebView(this);
        webView.setId(View.generateViewId());
        webView.setBackgroundColor(PAPER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value < 100 && !pageFailed ? View.VISIBLE : View.INVISIBLE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl(), request.hasGesture());
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!sameOrigin(Uri.parse(url))) {
                    view.stopLoading();
                    showError("页面跳转到了其他地址，请确认服务器地址后重试。");
                    return;
                }
                pageFailed = false;
                errorPanel.setVisibility(View.GONE);
                progress.setVisibility(View.VISIBLE);
            }

            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.INVISIBLE);
                CookieManager.getInstance().flush();
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                boolean https = "https".equalsIgnoreCase(scheme);
                boolean localDebug = BuildConfig.DEBUG && sameOrigin(uri) && "http".equalsIgnoreCase(scheme);
                if (!https && !localDebug) {
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                        Collections.emptyMap(), new ByteArrayInputStream("Blocked".getBytes(StandardCharsets.UTF_8)));
                }
                return null;
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("网络连接失败。请确认网络可用，且游戏服务器已经启动。");
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError("服务器返回错误（" + response.getStatusCode() + "），请稍后重试。");
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showError("服务器 HTTPS 证书验证失败。请联系管理员更新有效证书后重试。");
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view == webView) {
                    webFrame.removeView(view);
                    view.destroy();
                    webView = null;
                    showError("网页进程已关闭。重新连接后，请再次登录。");
                }
                return true;
            }
        });
        webFrame.addView(webView, 0, new FrameLayout.LayoutParams(-1, -1));
    }

    private boolean handleNavigation(Uri target, boolean hasGesture) {
        if (sameOrigin(target)) return false;
        if ("https".equalsIgnoreCase(target.getScheme()) && target.getHost() != null
            && target.getUserInfo() == null && hasGesture) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, target);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(intent);
            } catch (ActivityNotFoundException exception) {
                Toast.makeText(this, "未找到可打开链接的浏览器。", Toast.LENGTH_SHORT).show();
            }
        } else {
            Toast.makeText(this, "已阻止不受信任的页面跳转。", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private boolean sameOrigin(Uri target) {
        return serverOrigin != null && target.getUserInfo() == null
            && serverOrigin.getScheme().equalsIgnoreCase(target.getScheme())
            && serverOrigin.getHost().equalsIgnoreCase(target.getHost())
            && effectivePort(serverOrigin) == effectivePort(target);
    }

    private static int effectivePort(Uri uri) {
        return uri.getPort() == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }

    private void connect() {
        final String accepted;
        try {
            accepted = ServerAddress.normalize(serverInput.getText().toString(), BuildConfig.DEBUG);
        } catch (IllegalArgumentException exception) {
            serverInput.setError(exception.getMessage());
            return;
        }
        boolean changed = serverOrigin != null && !serverOrigin.toString().equals(accepted);
        serverOrigin = Uri.parse(accepted);
        preferences.edit().putString("server", accepted).apply();
        serverInput.setText(accepted);
        if (changed) {
            destroyWebView();
            WebStorage.getInstance().deleteAllData();
            connectButton.setEnabled(false);
            CookieManager.getInstance().removeAllCookies(removed -> {
                connectButton.setEnabled(true);
                if (!isFinishing() && !isDestroyed()) {
                    CookieManager.getInstance().flush();
                    showGame();
                    loadHome();
                }
            });
        } else {
            showGame();
            loadHome();
        }
    }

    private void loadHome() {
        if (serverOrigin == null) { showSetup(); return; }
        ensureWebView();
        pageFailed = false;
        errorPanel.setVisibility(View.GONE);
        webView.loadUrl(serverOrigin.toString());
    }

    private void showError(String message) {
        pageFailed = true;
        progress.setVisibility(View.INVISIBLE);
        errorMessage.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
        errorPanel.bringToFront();
    }

    private void showSetup() {
        showingSetup = true;
        setupScroll.setVisibility(View.VISIBLE);
        game.setVisibility(View.GONE);
    }

    private void showGame() {
        showingSetup = false;
        setupScroll.setVisibility(View.GONE);
        game.setVisibility(View.VISIBLE);
        ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
            .hideSoftInputFromWindow(serverInput.getWindowToken(), 0);
    }

    @Override public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (showingSetup && serverOrigin != null) { showGame(); return; }
        if (!showingSetup && webView != null && webView.canGoBack()) { webView.goBack(); return; }
        finish();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("showingSetup", showingSetup);
        if (webView != null) webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        destroyWebView();
        super.onDestroy();
    }

    private void destroyWebView() {
        if (webView == null) return;
        webFrame.removeView(webView);
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(new WebViewClient());
        webView.destroy();
        webView = null;
    }

    private TextView text(String label, int sp, int color) {
        TextView result = new TextView(this);
        result.setText(label);
        result.setTextSize(sp);
        result.setTextColor(color);
        return result;
    }

    private Button button(String label, View.OnClickListener listener) {
        Button result = new Button(this);
        result.setText(label);
        result.setAllCaps(false);
        result.setOnClickListener(listener);
        return result;
    }

    private void pad(View view, int top, int bottom) { view.setPadding(0, dp(top), 0, dp(bottom)); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
