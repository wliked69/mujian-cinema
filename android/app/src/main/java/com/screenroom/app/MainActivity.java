package com.screenroom.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.SharedPreferences;
import android.content.ComponentName;
import android.content.pm.ResolveInfo;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Collections;

import org.json.JSONObject;
import org.json.JSONTokener;

/** Thin native client: accounts, permissions and library remain on the user's server. */
public final class MainActivity extends ComponentActivity {
    private static final int BG = Color.rgb(17, 21, 20);
    private static final int PANEL = Color.rgb(26, 32, 29);
    private static final int TEXT = Color.rgb(239, 242, 234);
    private static final int MUTED = Color.rgb(172, 184, 176);
    private static final int ACCENT = Color.rgb(180, 217, 135);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Consumer<WindowLayoutInfo> foldListener = this::onFoldChanged;
    private SharedPreferences preferences;
    private ServerAddress server;
    private FrameLayout root, safeArea, mainPane, webContainer, fullscreenContainer;
    private ScrollView companion;
    private TextView foldLabel, playbackTitle, playbackTime;
    private SeekBar seekBar;
    private Button toggleButton, previousButton, forwardButton, nextEpisodeButton;
    private View setupView, errorView, customView;
    private ProgressBar progress;
    private WebView webView;
    private WebChromeClient.CustomViewCallback customCallback;
    private WindowInfoTrackerCallbackAdapter windowTracker;
    private FoldingFeature foldingFeature;
    private boolean ready, pageError, destroyed, seeking, active;
    private double mediaDuration;
    private String visibleMode = "";
    private AlertDialog connectionDialog;
    private LanDiscovery lanDiscovery;
    private int discoveryGeneration;
    private TextView discoveryStatus;
    private Button searchButton;
    private ValueCallback<Uri[]> pendingImageChoice;
    private final ActivityResultLauncher<String[]> imagePicker = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::completeImageChoice);

    private final Runnable playbackPoll = new Runnable() {
        @Override public void run() {
            if (!active || destroyed) return;
            if (companion.getVisibility() == View.VISIBLE && trustedPage()) {
                evaluate("(()=>{const v=document.getElementById('video'),d=document.getElementById('player-dialog'),s=document.getElementById('stream-select');"
                        + "if(!v||!d?.open||!v.getAttribute('src'))return null;return {title:document.getElementById('player-title')?.textContent||'',"
                        + "position:Number.isFinite(v.currentTime)?v.currentTime:0,duration:Number.isFinite(v.duration)?v.duration:0,"
                        + "paused:v.paused,hasNext:!!s&&!s.hidden&&s.selectedIndex<s.options.length-1,ready:v.readyState>0};})()",
                        value -> updatePlayback(value));
            } else resetPlayback();
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("screenroom_connection", MODE_PRIVATE);
        try { server = ServerAddress.parse(preferences.getString("server", "")); }
        catch (IllegalArgumentException ignored) { server = null; }
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        createShell();
        windowTracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { navigateBack(); }
        });
        if (server == null) { showSetup(); root.post(this::showConnectionSettings); }
        else {
            createWebView();
            // Only restore history belonging to the configured server; no passwords in Bundle/preferences.
            boolean restored = state != null && server.url().equals(state.getString("server"))
                    && webView.restoreState(state) != null;
            if (!restored || !server.contains(webView.getUrl())) webView.loadUrl(server.url());
        }
    }

    private void createShell() {
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        safeArea = new FrameLayout(this);
        root.addView(safeArea, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Android 15+ edge-to-edge, display cutouts and keyboard all use the safe content rectangle.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                l = edges.left; t = edges.top; r = edges.right; b = edges.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            root.setPadding(l, t, r, b);
            safeArea.post(this::layoutPanes);
            // The root already applied the safe area; do not add it again inside the page.
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        mainPane = new FrameLayout(this);
        webContainer = new FrameLayout(this);
        mainPane.addView(webContainer, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        mainPane.addView(progress);
        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(Color.BLACK);
        fullscreenContainer.setVisibility(View.GONE);
        mainPane.addView(fullscreenContainer, new FrameLayout.LayoutParams(-1, -1));
        safeArea.addView(mainPane);
        createCompanion();
        safeArea.addView(companion);
        safeArea.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> layoutPanes());
    }

    private void createCompanion() {
        companion = new ScrollView(this);
        companion.setBackgroundColor(PANEL);
        companion.setFillViewport(true);
        LinearLayout content = column(24);
        companion.addView(content, new ScrollView.LayoutParams(-1, -2));
        TextView mark = text("幕间  /  SCREEN ROOM", 13, ACCENT);
        mark.setLetterSpacing(.12f);
        content.addView(mark);
        foldLabel = text("折叠屏控制区", 24, TEXT);
        foldLabel.setTypeface(null, Typeface.BOLD);
        add(content, foldLabel, 20);
        add(content, text("画面与控制分开放置，避开屏幕铰链。", 14, MUTED), 8);
        playbackTitle = text("在片库中选择一部影片", 19, TEXT);
        playbackTitle.setMaxLines(3);
        add(content, playbackTitle, 28);
        playbackTime = text("开始播放后，可在这里控制进度。", 13, MUTED);
        add(content, playbackTime, 10);
        seekBar = new SeekBar(this);
        seekBar.setMax(1000);
        seekBar.setContentDescription("播放进度");
        seekBar.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        add(content, seekBar, 8);
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(SeekBar bar) { seeking = true; }
            @Override public void onProgressChanged(SeekBar bar, int p, boolean fromUser) {
                if (fromUser) playbackTime.setText(getString(R.string.playback_time, formatTime(mediaDuration * p / 1000), formatTime(mediaDuration)));
            }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                if (mediaDuration > 0) videoAction("v.currentTime=" + (mediaDuration * bar.getProgress() / 1000) + ";");
                seeking = false;
            }
        });
        toggleButton = actionButton("播放 / 暂停", () -> videoAction("if(v.paused)v.play().catch(()=>{});else v.pause();"));
        add(content, toggleButton, 10);
        LinearLayout skips = new LinearLayout(this);
        previousButton = smallButton("后退 10 秒", () -> videoAction("v.currentTime=Math.max(0,v.currentTime-10);"));
        forwardButton = smallButton("前进 10 秒", () -> videoAction("v.currentTime=Math.min(v.duration||0,v.currentTime+10);"));
        skips.addView(previousButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        skips.addView(forwardButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        add(content, skips, 4);
        nextEpisodeButton = smallButton("下一集 / 线路", () -> evaluate(
                "(()=>{const s=document.getElementById('stream-select');if(s&&!s.hidden&&s.selectedIndex<s.options.length-1){"
                        + "s.selectedIndex++;s.dispatchEvent(new Event('change',{bubbles:true}));}})()", null));
        add(content, nextEpisodeButton, 4);
        resetPlayback();
        companion.setVisibility(View.GONE);
    }

    @SuppressLint("SetJavaScriptEnabled") // Required by our server UI; messages are restricted to the configured origin.
    private void createWebView() {
        ready = false; pageError = false;
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ScreenRoomAndroid/1.2.2");
        installMobileBridge(webView);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (server != null && server.contains(url)) return false;
                if (request.isForMainFrame() && request.hasGesture() && ServerAddress.isExternalWebLink(url)) {
                    new AlertDialog.Builder(MainActivity.this).setTitle("在浏览器打开？")
                            .setMessage("目标站点：" + request.getUrl().getHost() + "\n\n这不是当前片库的页面，将离开幕间并交由系统浏览器打开。")
                            .setNegativeButton("取消", null).setPositiveButton("打开", (d, w) -> {
                                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
                                catch (android.content.ActivityNotFoundException e) { toast("未找到可用的浏览器。"); }
                            }).show();
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                cancelImageChoice();
                ready = false;
                if (server == null || !server.contains(url)) {
                    view.stopLoading(); showError("已阻止离开当前片库的页面跳转。"); return;
                }
                pageError = false; hideError(); progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                ready = !pageError && server != null && server.contains(url);
                progress.setVisibility(View.GONE);
                cookies.flush();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("暂时连接不上片库。请检查服务器是否启动、地址与端口，以及手机和服务器是否在同一网络。");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError("片库返回错误（" + response.getStatusCode() + "）。请检查服务器后重试。");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
                ssl.cancel(); showError("服务器证书不可信，连接已停止。请修复 HTTPS 证书；客户端不会忽略证书错误。");
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                ready = false; hideCustomView();
                webContainer.removeView(view); view.destroy(); webView = null;
                showError("页面已停止运行，点击重新连接可恢复。"); return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (view != webView || !trustedPage() || destroyed || params.getMode() != FileChooserParams.MODE_OPEN) return false;
                // Only a user-chosen image from the Android document picker, never arbitrary file paths.
                cancelImageChoice(); pendingImageChoice = callback;
                try { imagePicker.launch(new String[] { "image/jpeg", "image/png", "image/webp" }); }
                catch (RuntimeException error) { cancelImageChoice(); toast("无法打开图片选择器，请使用手机浏览器上传。 "); }
                return true;
            }
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                if (value == 100) progress.setVisibility(View.GONE);
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view; customCallback = callback;
                fullscreenContainer.addView(view, new FrameLayout.LayoutParams(-1, -1));
                fullscreenContainer.setVisibility(View.VISIBLE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                layoutPanes();
            }
            @Override public void onHideCustomView() { hideCustomView(); }
        });
        webContainer.addView(webView, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showSetup() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        FrameLayout centered = new FrameLayout(this);
        LinearLayout content = column(24);
        content.setGravity(Gravity.CENTER_VERTICAL);
        TextView brand = text("幕间", 42, TEXT);
        brand.setTypeface(null, Typeface.BOLD);
        content.addView(brand);
        TextView sub = text("SCREEN ROOM  /  ANDROID", 12, ACCENT);
        sub.setLetterSpacing(.15f);
        add(content, sub, 10);
        add(content, text("把你的片库，带到手边。", 22, TEXT), 38);
        add(content, text("连接电脑或 NAS 上的幕间服务，浏览封面、选择剧集、查看演员与评论。适配外屏、大屏和半折叠姿态。", 15, MUTED), 12);
        add(content, actionButton("连接我的片库", this::showConnectionSettings), 28);
        add(content, text("不会上传或复制你的影片。电脑端需先启动服务，并由管理员手动允许局域网访问。", 13, MUTED), 16);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER);
        centered.addView(content, params);
        scroll.addView(centered, new ScrollView.LayoutParams(-1, -1));
        setupView = scroll;
        webContainer.addView(setupView, new FrameLayout.LayoutParams(-1, -1));
        progress.setVisibility(View.GONE);
    }

    private void showConnectionSettings() {
        if (connectionDialog != null && connectionDialog.isShowing()) return;
        LinearLayout content = column(22);
        add(content, text("填写运行幕间服务的电脑或 NAS 地址，不是视频文件路径。", 14, MUTED), 0);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("http://192.168.1.10:3210");
        input.setTextSize(16);
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setText(server == null ? "" : server.url());
        input.setSelectAllOnFocus(true);
        input.setAutofillHints((String[]) null);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        add(content, input, 12);
        TextView error = text("", 13, Color.rgb(255, 168, 155));
        error.setVisibility(View.GONE);
        add(content, error, 8);
        LinearLayout results = column(0);
        discoveryStatus = text("打开本页后自动搜索局域网片库；也可手动输入地址。", 13, MUTED);
        searchButton = smallButton("重新搜索局域网", () -> searchLan(input, results));
        add(content, searchButton, 10);
        add(content, discoveryStatus, 6);
        add(content, results, 6);
        add(content, smallButton("手机播放器设置", this::showMobilePlaybackSettings), 14);
        add(content, text("1. 手机与服务器连接同一网络。\n2. 电脑端：左下角设置 → 服务与网络 → 允许局域网，保存后重启服务。\n3. 使用电脑的局域网 IP 和已设置端口。127.0.0.1 指手机自己，不是电脑。\n\nHTTP 不加密，仅在可信局域网使用；公网请用 HTTPS。不会自动修改网络或防火墙。", 13, MUTED), 14);
        if (server != null) add(content, smallButton("清除此 App 的登录", this::confirmClearLogin), 10);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        connectionDialog = new AlertDialog.Builder(this).setTitle("App 设置").setView(scroll)
                .setNegativeButton("取消", null).setPositiveButton("连接", null).create();
        connectionDialog.setOnShowListener(ignored -> connectionDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                ServerAddress selected = ServerAddress.parse(input.getText().toString());
                if (selected.isLoopback()) {
                    new AlertDialog.Builder(this).setTitle("这是手机本机地址")
                            .setMessage("127.0.0.1 / localhost 指此安卓设备。连接电脑片库请改填电脑局域网 IP；只有服务确实运行在手机或使用端口转发时才继续。")
                            .setNegativeButton("修改地址", null).setPositiveButton("仍然连接", (d, w) -> connect(selected)).show();
                } else connect(selected);
            } catch (IllegalArgumentException e) { error.setText(e.getMessage()); error.setVisibility(View.VISIBLE); }
        }));
        connectionDialog.show();
        connectionDialog.setOnDismissListener(ignored -> stopDiscovery());
        searchLan(input, results);
    }

    private void searchLan(EditText input, LinearLayout results) {
        stopDiscovery();
        int generation = discoveryGeneration;
        results.removeAllViews(); searchButton.setEnabled(false);
        discoveryStatus.setText("正在搜索同一局域网中的幕间服务器…（约 7 秒）");
        lanDiscovery = new LanDiscovery();
        lanDiscovery.start(new LanDiscovery.Listener() {
            private boolean current() { return !destroyed && generation == discoveryGeneration && connectionDialog != null && connectionDialog.isShowing(); }
            @Override public void found(String address) { handler.post(() -> {
                if (!current()) return;
                add(results, smallButton("幕间片库 · " + address, () -> { input.setText(address); discoveryStatus.setText("已填入地址，请确认是自己的服务器后点击连接。"); }), 4);
            }); }
            @Override public void finished(String message) { handler.post(() -> {
                if (!current()) return;
                searchButton.setEnabled(true); discoveryStatus.setText(message);
            }); }
        });
    }
    private void stopDiscovery() {
        discoveryGeneration++;
        if (lanDiscovery != null) { lanDiscovery.stop(); lanDiscovery = null; }
        if (searchButton != null) searchButton.setEnabled(true);
    }

    private void showMobilePlaybackSettings() {
        LinearLayout content = column(20);
        add(content, text("只改变这台手机。在影片详情中点击播放时使用这里选择的方式；不会调用电脑播放器。", 14, MUTED), 0);
        RadioGroup group = new RadioGroup(this);
        RadioButton internal = new RadioButton(this); internal.setId(View.generateViewId()); internal.setText(R.string.mobile_internal); internal.setTextColor(TEXT);
        RadioButton external = new RadioButton(this); external.setId(View.generateViewId()); external.setText(R.string.mobile_external); external.setTextColor(TEXT);
        external.setEnabled(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        group.addView(internal); group.addView(external);
        group.check(preferences.getBoolean("mobile_external", false) && external.isEnabled() ? external.getId() : internal.getId());
        add(content, group, 12);
        Button choose = smallButton("选择默认手机播放器", this::chooseMobilePlayer);
        add(content, choose, 6);
        add(content, text("可选择已安装且支持网络视频的播放器，或每次由系统询问。仅交给播放器当前视频的临时播放地址，不交出账号密码或登录 Cookie。外部播放的进度不保证回传 App。", 13, MUTED), 12);
        if (!external.isEnabled()) add(content, text("当前系统 WebView 过旧，请更新后再使用手机外部播放器。", 13, MUTED), 8);
        new AlertDialog.Builder(this).setTitle("手机播放器设置").setView(content).setNegativeButton("取消", null)
                .setPositiveButton("保存", (d, w) -> { preferences.edit().putBoolean("mobile_external", group.getCheckedRadioButtonId() == external.getId()).apply(); toast("手机播放器设置已保存。"); }).show();
    }
    private Intent videoIntent(String address, String mime) {
        return new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(address).normalizeScheme(), mime);
    }
    private List<ResolveInfo> matchingVideoPlayers(Intent intent) {
        return getPackageManager().queryIntentActivities(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
                .stream().filter(p -> p.activityInfo != null && p.activityInfo.exported && p.activityInfo.enabled
                        && !getPackageName().equals(p.activityInfo.packageName)).collect(java.util.stream.Collectors.toList());
    }
    private static ComponentName playerComponent(ResolveInfo player) {
        return new ComponentName(player.activityInfo.packageName, player.activityInfo.name);
    }
    private List<ResolveInfo> mobilePlayers() {
        var found = new LinkedHashMap<ComponentName, ResolveInfo>();
        // A settings-time discovery list, not a compatibility test for a specific video.
        for (String scheme : new String[] {"http", "https"}) {
            for (String mime : new String[] {PlaybackPolicy.GENERIC_VIDEO, PlaybackPolicy.HLS_VIDEO}) {
                for (ResolveInfo info : matchingVideoPlayers(videoIntent(scheme + "://127.0.0.1/" + (PlaybackPolicy.HLS_VIDEO.equals(mime) ? "video.m3u8" : "video.mp4"), mime)))
                    found.putIfAbsent(playerComponent(info), info);
            }
        }
        return new ArrayList<>(found.values());
    }
    private void launchMobileVideo(String address, String mimeHint) {
        if (!PlaybackPolicy.allowed(server, address)) throw new IllegalArgumentException("播放地址不符合安全规则。");
        String mime = PlaybackPolicy.videoMime(address, mimeHint);
        Intent specific = videoIntent(address, mime);
        Intent generic = PlaybackPolicy.GENERIC_VIDEO.equals(mime) ? specific : videoIntent(address, PlaybackPolicy.GENERIC_VIDEO);
        List<ResolveInfo> exactMatches = matchingVideoPlayers(specific);
        List<ResolveInfo> genericMatches = generic == specific ? exactMatches : matchingVideoPlayers(generic);
        String saved = preferences.getString("mobile_player", "");
        ComponentName chosen = ComponentName.unflattenFromString(saved);
        if (chosen != null) {
            Intent selected = exactMatches.stream().anyMatch(p -> chosen.equals(playerComponent(p))) ? specific
                    : genericMatches.stream().anyMatch(p -> chosen.equals(playerComponent(p))) ? generic : null;
            if (selected != null) {
                try {
                    pauseVideo();
                    startActivity(new Intent(selected).setComponent(chosen));
                    return;
                } catch (ActivityNotFoundException | SecurityException ignored) { /* Offer other compatible players. */ }
            }
        }
        Intent fallback = !exactMatches.isEmpty() ? specific : !genericMatches.isEmpty() ? generic : null;
        if (fallback == null) throw new IllegalArgumentException("没有找到能打开此网络视频的手机播放器。请安装支持网络播放的应用，或在设置中改用内置播放。");
        pauseVideo();
        try { startActivity(Intent.createChooser(fallback, "选择手机播放器")); }
        catch (ActivityNotFoundException | SecurityException ignored) {
            throw new IllegalArgumentException("无法打开手机播放器。请检查播放器是否可用，或在设置中改用内置播放。");
        }
    }
    private void chooseMobilePlayer() {
        List<ResolveInfo> players = mobilePlayers();
        List<String> labels = new ArrayList<>(); labels.add("每次由系统选择");
        for (ResolveInfo player : players) labels.add(player.loadLabel(getPackageManager()).toString());
        new AlertDialog.Builder(this).setTitle("默认手机播放器").setItems(labels.toArray(new String[0]), (dialog, which) -> {
            String component = which == 0 ? "" : playerComponent(players.get(which - 1)).flattenToString();
            preferences.edit().putString("mobile_player", component).apply();
            toast("已选择：" + labels.get(which));
        }).setNegativeButton("取消", null).show();
        if (players.isEmpty()) toast("没有检测到支持网络视频的播放器，请先安装你信任的播放器。");
    }
    private void installMobileBridge(WebView target) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        String origin = server.url().substring(0, server.url().length() - 1);
        WebViewCompat.addWebMessageListener(target, "ScreenRoomAndroid", Collections.singleton(origin), (view, message, sourceOrigin, mainFrame, reply) -> {
            if (destroyed || !mainFrame || view != webView || server == null || !server.contains(sourceOrigin.toString()) || !active) return;
            String raw;
            try { raw = message.getData(); } catch (IllegalStateException ignored) { return; }
            if (raw == null || raw.length() > 12000) return;
            String id = "";
            try {
                JSONObject request = new JSONObject(raw); id = request.optString("id");
                if (!id.matches("[a-zA-Z0-9_-]{1,60}")) return;
                switch (request.optString("type")) {
                    case "getPlayback" -> reply(reply, id, true, preferences.getBoolean("mobile_external", false) ? "external" : "internal");
                    case "settings" -> { showMobilePlaybackSettings(); reply(reply, id, true, "opened"); }
                    case "connectionSettings" -> { showConnectionSettings(); reply(reply, id, true, "opened"); }
                    case "openVideo" -> {
                        if (!preferences.getBoolean("mobile_external", false)) throw new IllegalArgumentException("当前使用内置播放，请先在设置中选择手机外部播放器。");
                        // Send only the validated video URL and media type, without account credentials or headers.
                        launchMobileVideo(request.optString("url"), request.optString("mime"));
                        reply(reply, id, true, "opened");
                    }
                    default -> reply(reply, id, false, "不支持的 App 操作。");
                }
            } catch (Exception e) { reply(reply, id, false, e instanceof IllegalArgumentException ? e.getMessage() : "无法打开手机播放器，请检查安装状态或改用内置播放。"); }
        });
    }
    private void reply(JavaScriptReplyProxy proxy, String id, boolean ok, String value) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try { proxy.postMessage(new JSONObject().put("id", id).put("ok", ok).put("value", value).toString()); }
        catch (Exception ignored) { /* Page may have closed while the external activity opened. */ }
    }

    private void connect(ServerAddress selected) {
        cancelImageChoice();
        hideCustomView();
        pauseVideo();
        preferences.edit().putString("server", selected.url()).apply();
        server = selected;
        if (connectionDialog != null) connectionDialog.dismiss();
        hideError();
        if (setupView != null) { webContainer.removeView(setupView); setupView = null; }
        if (webView != null) { webContainer.removeView(webView); webView.destroy(); webView = null; }
        createWebView();
        webView.loadUrl(server.url());
    }

    private void confirmClearLogin() {
        new AlertDialog.Builder(this).setTitle("清除此 App 的登录？")
                .setMessage("将清除 App 保存的所有站点 Cookie 和网页本地数据，下次需要重新登录。不删除服务器账号、片库、评论或其他设备的登录。")
                .setNegativeButton("取消", null).setPositiveButton("清除", (dialog, which) -> {
                    pauseVideo();
                    hideCustomView();
                    ready = false;
                    // Stop the old page before clearing cookies so an in-flight page cannot immediately restore a session.
                    if (webView != null) {
                        webView.stopLoading(); webContainer.removeView(webView); webView.destroy(); webView = null;
                    }
                    CookieManager.getInstance().removeAllCookies(done -> {
                        CookieManager.getInstance().flush();
                        WebStorage.getInstance().deleteAllData();
                        if (server != null && !destroyed) { if (webView != null) webView.clearCache(true); connect(server); }
                        toast("已清除此 App 的登录。");
                    });
                }).show();
    }

    private void showError(String message) {
        pageError = true; ready = false; progress.setVisibility(View.GONE); resetPlayback();
        hideError();
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        LinearLayout content = column(26);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.addView(text("暂时没有连上", 25, TEXT));
        add(content, text(message, 15, MUTED), 12);
        add(content, actionButton("重新连接", () -> {
            if (server == null) showConnectionSettings();
            else { hideError(); if (webView == null) createWebView(); webView.loadUrl(server.url()); }
        }), 24);
        add(content, smallButton("更换服务器", this::showConnectionSettings), 8);
        scroll.addView(content, new ScrollView.LayoutParams(-1, -1));
        errorView = scroll;
        webContainer.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
    }
    private void hideError() { if (errorView != null) { webContainer.removeView(errorView); errorView = null; } }

    private void onFoldChanged(WindowLayoutInfo info) {
        foldingFeature = null;
        for (DisplayFeature feature : info.getDisplayFeatures()) {
            if (feature instanceof FoldingFeature fold && (fold.isSeparating() || fold.getState() == FoldingFeature.State.HALF_OPENED)) {
                foldingFeature = fold; break;
            }
        }
        layoutPanes();
    }

    private void layoutPanes() {
        if (safeArea == null || safeArea.getWidth() == 0 || safeArea.getHeight() == 0) return;
        FoldLayoutCalculator.Box hinge = null;
        boolean vertical = false;
        if (foldingFeature != null) {
            Rect bounds = foldingFeature.getBounds();
            int[] location = new int[2];
            safeArea.getLocationInWindow(location);
            hinge = new FoldLayoutCalculator.Box(bounds.left - location[0], bounds.top - location[1],
                    bounds.right - location[0], bounds.bottom - location[1]);
            vertical = foldingFeature.getOrientation() == FoldingFeature.Orientation.VERTICAL;
        }
        FoldLayoutCalculator.Layout layout = FoldLayoutCalculator.calculate(safeArea.getWidth(), safeArea.getHeight(),
                hinge, vertical, hinge != null, dp(6), dp(120));
        place(mainPane, layout.main);
        companion.setVisibility(layout.companion == null ? View.GONE : View.VISIBLE);
        if (layout.companion != null) place(companion, layout.companion);
        String mode = layout.mode == FoldLayoutCalculator.Mode.TABLETOP ? "半折叠 · 桌面模式"
                : layout.mode == FoldLayoutCalculator.Mode.BOOK ? "折叠屏 · 双区模式" : "";
        if (!mode.equals(visibleMode)) { visibleMode = mode; foldLabel.setText(mode); }
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP);
        setParamsIfChanged(progress, progressParams);
    }
    private void place(View view, FoldLayoutCalculator.Box box) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(box.width(), box.height());
        params.leftMargin = box.left; params.topMargin = box.top;
        setParamsIfChanged(view, params);
    }
    private void setParamsIfChanged(View view, FrameLayout.LayoutParams next) {
        ViewGroup.LayoutParams raw = view.getLayoutParams();
        if (raw instanceof FrameLayout.LayoutParams old && old.width == next.width && old.height == next.height
                && old.leftMargin == next.leftMargin && old.topMargin == next.topMargin && old.bottomMargin == next.bottomMargin
                && old.rightMargin == next.rightMargin && old.gravity == next.gravity) return;
        view.setLayoutParams(next);
    }

    private boolean trustedPage() { return ready && webView != null && server != null && server.contains(webView.getUrl()); }
    private void evaluate(String script, android.webkit.ValueCallback<String> callback) {
        if (!destroyed && trustedPage()) {
            WebView target = webView;
            target.evaluateJavascript(script, callback == null ? null : value -> {
                if (!destroyed && webView == target && trustedPage()) callback.onReceiveValue(value);
            });
        }
    }
    private void videoAction(String action) {
        evaluate("(()=>{const v=document.getElementById('video'),d=document.getElementById('player-dialog');if(v&&d?.open){" + action + "}})()", null);
    }
    private void pauseVideo() { videoAction("v.pause();"); }
    private void updatePlayback(String raw) {
        if (!active || destroyed || !trustedPage()) return;
        try {
            Object parsed = new JSONTokener(raw).nextValue();
            if (!(parsed instanceof JSONObject data)) { resetPlayback(); return; }
            boolean playable = data.optBoolean("ready");
            mediaDuration = data.optDouble("duration", 0);
            playbackTitle.setText(data.optString("title", "正在播放"));
            toggleButton.setText(data.optBoolean("paused") ? "播放" : "暂停");
            toggleButton.setEnabled(playable);
            previousButton.setEnabled(playable); forwardButton.setEnabled(playable);
            seekBar.setEnabled(playable && mediaDuration > 0);
            nextEpisodeButton.setEnabled(data.optBoolean("hasNext"));
            if (!seeking) {
                double position = data.optDouble("position", 0);
                seekBar.setProgress(mediaDuration > 0 ? (int) (position / mediaDuration * 1000) : 0);
                playbackTime.setText(getString(R.string.playback_time, formatTime(position), formatTime(mediaDuration)));
            }
        } catch (Exception ignored) { resetPlayback(); }
    }
    private void resetPlayback() {
        if (playbackTitle == null) return;
        mediaDuration = 0;
        playbackTitle.setText("在片库中选择一部影片");
        playbackTime.setText("开始播放后，可在这里控制进度。");
        if (seekBar != null) { seekBar.setEnabled(false); seekBar.setProgress(0); }
        if (toggleButton != null) { toggleButton.setEnabled(false); toggleButton.setText("播放 / 暂停"); }
        if (previousButton != null) previousButton.setEnabled(false);
        if (forwardButton != null) forwardButton.setEnabled(false);
        if (nextEpisodeButton != null) nextEpisodeButton.setEnabled(false);
    }
    private String formatTime(double seconds) {
        int s = Double.isFinite(seconds) ? Math.max(0, (int) seconds) : 0;
        return s >= 3600 ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                : String.format(java.util.Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }
    private void hideCustomView() {
        if (customView == null) return;
        fullscreenContainer.removeAllViews(); fullscreenContainer.setVisibility(View.GONE);
        customView = null;
        WebChromeClient.CustomViewCallback callback = customCallback; customCallback = null;
        if (callback != null) callback.onCustomViewHidden();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        layoutPanes();
    }
    private void navigateBack() {
        if (customView != null) { hideCustomView(); return; }
        if (trustedPage()) {
            evaluate("(()=>{const d=[...document.querySelectorAll('dialog[open]')].pop();if(d){d.close();return true;}return false;})()", value -> {
                if (!destroyed && !"true".equals(value)) historyBack();
            });
        } else historyBack();
    }
    private void historyBack() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        // Keep the same WebView / media element through folds, orientation and split-screen resizing.
        root.requestApplyInsets(); safeArea.post(this::layoutPanes);
    }
    @Override protected void onStart() {
        super.onStart();
        windowTracker.addWindowLayoutInfoListener(this, this::runOnUiThread, foldListener);
    }
    @Override protected void onResume() {
        super.onResume(); active = true;
        if (webView != null) webView.onResume();
        handler.removeCallbacks(playbackPoll); handler.post(playbackPoll);
    }
    @Override protected void onPause() {
        stopDiscovery();
        pauseVideo(); active = false; handler.removeCallbacks(playbackPoll);
        CookieManager.getInstance().flush();
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override protected void onStop() {
        windowTracker.removeWindowLayoutInfoListener(foldListener);
        super.onStop();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (server != null) out.putString("server", server.url());
        if (webView != null && trustedPage()) webView.saveState(out);
        super.onSaveInstanceState(out);
    }
    @Override protected void onDestroy() {
        cancelImageChoice();
        stopDiscovery();
        destroyed = true; handler.removeCallbacksAndMessages(null);
        if (connectionDialog != null) connectionDialog.dismiss();
        hideCustomView();
        if (webView != null) { webContainer.removeView(webView); webView.destroy(); webView = null; }
        super.onDestroy();
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void cancelImageChoice() {
        ValueCallback<Uri[]> callback = pendingImageChoice; pendingImageChoice = null;
        if (callback != null) callback.onReceiveValue(null);
    }
    private void completeImageChoice(Uri image) {
        ValueCallback<Uri[]> callback = pendingImageChoice; pendingImageChoice = null;
        if (callback == null) return;
        if (destroyed || !trustedPage() || image == null || !"content".equals(image.getScheme())) { callback.onReceiveValue(null); return; }
        try {
            String type = getContentResolver().getType(image);
            if (!"image/jpeg".equals(type) && !"image/png".equals(type) && !"image/webp".equals(type)) throw new IllegalArgumentException();
            try (android.content.res.AssetFileDescriptor file = getContentResolver().openAssetFileDescriptor(image, "r")) {
                if (file == null || file.getLength() > 5L * 1024 * 1024) throw new IllegalArgumentException();
            }
            callback.onReceiveValue(new Uri[] { image });
        } catch (Exception error) { callback.onReceiveValue(null); toast("请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片。"); }
    }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setLineSpacing(dp(3), 1);
        return view;
    }
    private LinearLayout column(int padding) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(padding), dp(padding), dp(padding), dp(padding));
        return layout;
    }
    private Button smallButton(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label); button.setTextSize(13); button.setAllCaps(false); button.setTextColor(ACCENT);
        button.setBackgroundResource(android.R.drawable.list_selector_background);
        button.setMinimumHeight(dp(48));
        button.setOnClickListener(v -> action.run());
        return button;
    }
    private Button actionButton(String label, Runnable action) {
        Button button = smallButton(label, action);
        button.setTextColor(BG); button.setTextSize(16);
        GradientDrawable background = new GradientDrawable();
        background.setColor(ACCENT); background.setCornerRadius(dp(12));
        button.setBackground(background);
        return button;
    }
    private void add(LinearLayout parent, View child, int marginTop) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(marginTop);
        parent.addView(child, params);
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }

}
