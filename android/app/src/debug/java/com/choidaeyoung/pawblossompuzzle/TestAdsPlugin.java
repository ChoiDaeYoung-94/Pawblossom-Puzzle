package com.choidaeyoung.pawblossompuzzle;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ads.mediation.admob.AdMobAdapter;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AgeRestrictedTreatment;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.RequestConfiguration;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;

/** 자체 작성한 debug 전용 수동 시험 광고. load()/생성자에는 SDK 호출이 없습니다. */
@CapacitorPlugin(name = "PawblossomTestAds")
public class TestAdsPlugin extends Plugin {
    private static final String APP_ID = "ca-app-pub-3940256099942544~3347511713";
    private static final String UNIT_ID = "ca-app-pub-3940256099942544/1033173712";
    private static final String REWARDED_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";
    private final Handler main = new Handler(Looper.getMainLooper());
    private String state = "idle", error = "";
    private long revision = 0, attempt = 0, readyAt = 0;
    private boolean destroyed = false, initialized = false, initializing = false;
    private boolean privacyRequired = false;
    private boolean consentUpdated = false;
    private ConsentInformation consent;
    private InterstitialAd ad;
    private RewardedAd rewardedAd;
    private String format = "interstitial";
    private final RewardLedger rewards = new RewardLedger();
    private Runnable timeout;

    @Override public void load() {
        TestCommerce.adsChanged = () -> {
            if (!destroyed && TestCommerce.blocksAds(getContext())) {
                rewards.invalidate();
                if (!overlay() && (busy() || state.equals("ready"))) fail("billing-blocked");
            }
        };
    }

    // 웹 플래그 외에 패키지 내 실제 에셋과 Manifest까지 확인합니다. 누락/손상은 차단합니다.
    private boolean available() {
        try (var stream = getContext().getAssets().open("public/build-info.json")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[256]; int count;
            while ((count = stream.read(chunk)) != -1) {
                buffer.write(chunk, 0, count);
                if (buffer.size() > 4096) return false;
            }
            JSONObject info = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            ApplicationInfo app = getContext().getPackageManager().getApplicationInfo(getContext().getPackageName(), 128);
            return !destroyed && (app.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0
                && Boolean.TRUE.equals(info.opt("testTools")) && Boolean.TRUE.equals(info.opt("androidTestAds"))
                && app.metaData != null && APP_ID.equals(app.metaData.getString("com.google.android.gms.ads.APPLICATION_ID"));
        } catch (Exception ignored) { return false; }
    }

    private boolean foreground() {
        return getActivity() != null && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && getBridge().getApp().isActive();
    }

    private boolean current(long id) { return !destroyed && attempt == id; }
    private void safely(long id, Runnable action) {
        if (!current(id)) return;
        try { action.run(); } catch (Exception e) { if (current(id)) fail("sdk"); }
    }
    private boolean overlay() { return state.equals("privacy") || state.equals("presenting") || state.equals("showing"); }
    private boolean busy() { return overlay() || state.equals("consent") || state.equals("loading"); }
    private void stopTimer() { if (timeout != null) main.removeCallbacks(timeout); timeout = null; }
    private void armTimer(long id) {
        stopTimer();
        timeout = () -> { if (current(id) && !overlay()) fail("timeout"); };
        main.postDelayed(timeout, 45000);
    }
    private void expireReady() {
        if (state.equals("ready") && SystemClock.elapsedRealtime() - readyAt >= 3300000) fail("expired");
    }
    private JSObject snapshot() {
        expireReady();
        JSObject result = new JSObject();
        result.put("available", available()); result.put("state", state); result.put("revision", revision);
        result.put("error", error); result.put("privacyRequired", privacyRequired);
        result.put("bridgeVersion", 3); result.put("format", format); result.put("rewardEvents", rewards.events());
        RewardLedger.Receipt receipt = rewards.receipt();
        if (receipt == null) result.put("receipt", JSONObject.NULL);
        else {
            JSObject value = new JSObject(); value.put("requestId", receipt.requestId); value.put("attemptId", receipt.attemptId);
            value.put("earned", receipt.earned); value.put("closed", receipt.closed); result.put("receipt", value);
        }
        return result;
    }
    private void update(String next, String reason) {
        state = next; error = reason; revision++;
        TestCommerce.adOverlay = overlay();
        notifyListeners("stateChange", snapshot());
    }
    private void discard() { discard(false); }
    private void discard(boolean preserveReceipt) {
        if (ad != null) ad.setFullScreenContentCallback(null);
        if (rewardedAd != null) rewardedAd.setFullScreenContentCallback(null);
        if (!preserveReceipt) rewards.invalidate(); ad = null; rewardedAd = null; readyAt = 0;
    }
    private void fail(String reason) {
        attempt++; stopTimer(); discard(); update("failed", reason);
    }
    private boolean guard(PluginCall call) {
        if (!available()) { call.reject("시험 광고 구성이 없습니다.", "unavailable"); return false; }
        return true;
    }
    @PluginMethod public void getStatus(PluginCall call) { main.post(() -> call.resolve(snapshot())); }
    @PluginMethod public void selectFormat(PluginCall call) {
        main.post(() -> {
            if (!guard(call)) return;
            expireReady();
            String requested = call.getString("format");
            if (!"interstitial".equals(requested) && !"rewarded".equals(requested)) { call.reject("지원하지 않는 광고 형식입니다.", "format"); return; }
            if (busy() || state.equals("ready")) { call.resolve(snapshot()); return; }
            if (!format.equals(requested)) { attempt++; stopTimer(); discard(); format = requested; update("idle", ""); }
            call.resolve(snapshot());
        });
    }

    private void protectRequests() {
        MobileAds.setRequestConfiguration(new RequestConfiguration.Builder()
            .setAgeRestrictedTreatment(AgeRestrictedTreatment.CHILD)
            .setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_G).build());
    }

    @PluginMethod public void prepare(PluginCall call) {
        main.post(() -> {
            if (!guard(call)) return;
            expireReady();
            if (busy() || state.equals("ready")) { call.resolve(snapshot()); return; }
            if (TestCommerce.blocksAds(getContext())) { fail("billing-blocked"); call.resolve(snapshot()); return; }
            if (!foreground()) { call.reject("앱이 비활성 상태입니다.", "inactive"); return; }
            if (initializing) { call.reject("SDK 초기화 응답을 기다리고 있습니다. 앱을 다시 열어 주세요.", "initializing"); return; }
            discard(); consentUpdated = false; final long id = ++attempt;
            update("consent", ""); armTimer(id);
            try {
                // GMA 보호 신호와 별개인 UMP 미성년 신호를 GMA initialize 이전 적용합니다.
                protectRequests();
                consent = UserMessagingPlatform.getConsentInformation(getContext());
                ConsentRequestParameters params = new ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(true).build();
                consent.requestConsentInfoUpdate(getActivity(), params, () -> safely(id, () -> {
                    if (!current(id) || consentUpdated || !state.equals("consent")) return;
                    consentUpdated = true;
                    privacyRequired = consent.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
                    if (!foreground()) { fail("inactive"); return; }
                    if (consent.getConsentStatus() != ConsentInformation.ConsentStatus.REQUIRED) { consentComplete(id); return; }
                    try {
                        UserMessagingPlatform.loadConsentForm(getContext(), form -> {
                            if (!current(id) || !state.equals("consent")) return;
                            if (TestCommerce.blocksAds(getContext())) { fail("billing-blocked"); return; }
                            if (!foreground()) { fail("inactive"); return; }
                            // 실제 표시된 양식만 시간 초과 취소에서 제외합니다.
                            stopTimer(); update("privacy", "");
                            try { form.show(getActivity(), formError -> {
                                if (!current(id) || !state.equals("privacy")) return;
                                if (formError != null) fail("consent:" + formError.getErrorCode());
                                else consentComplete(id);
                            }); } catch (Exception e) { fail("sdk"); }
                        }, formError -> { if (current(id) && state.equals("consent")) fail("consent:" + formError.getErrorCode()); });
                    } catch (Exception e) { fail("sdk"); }
                }), consentError -> { if (current(id) && !consentUpdated) fail("consent:" + consentError.getErrorCode()); });
            } catch (Exception e) { if (current(id)) fail("sdk"); }
            call.resolve(snapshot());
        });
    }

    private void consentComplete(long id) {
        if (!current(id) || !(state.equals("consent") || state.equals("privacy"))) return;
        try {
            if (TestCommerce.blocksAds(getContext())) { fail("billing-blocked"); return; }
            privacyRequired = consent.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
            if (!consent.canRequestAds() || consent.getConsentStatus() == ConsentInformation.ConsentStatus.UNKNOWN) { fail("consent-blocked"); return; }
            if (!foreground()) { fail("inactive"); return; }
            update("loading", ""); armTimer(id); initializeAndLoad(id);
        } catch (Exception e) { fail("sdk"); }
    }

    private void initializeAndLoad(long id) {
        if (!current(id)) return;
        if (initialized) { loadAd(id); return; }
        initializing = true;
        try {
            MobileAds.initialize(getContext(), status -> main.post(() -> {
                if (destroyed) return;
                initialized = true; initializing = false;
                if (current(id)) loadAd(id);
            }));
        } catch (Exception e) { initializing = false; fail("sdk"); }
    }
    private void loadAd(long id) {
        if (!current(id) || !state.equals("loading")) return;
        try {
            if (TestCommerce.blocksAds(getContext())) { fail("billing-blocked"); return; }
            if (!foreground() || consent == null || !consent.canRequestAds() || consent.getConsentStatus() == ConsentInformation.ConsentStatus.UNKNOWN) { fail("consent-blocked"); return; }
            Bundle extras = new Bundle(); extras.putString("npa", "1");
            AdRequest request = new AdRequest.Builder().addNetworkExtrasBundle(AdMobAdapter.class, extras).build();
            if (format.equals("rewarded")) {
                RewardedAd.load(getContext(), REWARDED_UNIT_ID, request, new RewardedAdLoadCallback() {
                    @Override public void onAdLoaded(RewardedAd loaded) {
                        if (!canAcceptLoaded(id)) return;
                        rewardedAd = loaded; rewards.begin(id); loaded(id);
                    }
                    @Override public void onAdFailedToLoad(LoadAdError e) { if (current(id) && state.equals("loading")) fail("load:" + e.getCode()); }
                });
            } else InterstitialAd.load(getContext(), UNIT_ID, request, new InterstitialAdLoadCallback() {
            @Override public void onAdLoaded(InterstitialAd loaded) {
                if (!canAcceptLoaded(id)) return;
                ad = loaded; loaded(id);
            }
            @Override public void onAdFailedToLoad(LoadAdError e) { if (current(id) && state.equals("loading")) fail("load:" + e.getCode()); }
            });
        } catch (Exception e) { if (current(id)) fail("sdk"); }
    }

    private boolean canAcceptLoaded(long id) {
        if (!current(id) || !state.equals("loading")) return false;
        if (TestCommerce.blocksAds(getContext())) { fail("billing-blocked"); return false; }
        if (!foreground() || consent == null || !consent.canRequestAds() || consent.getConsentStatus() == ConsentInformation.ConsentStatus.UNKNOWN) { fail("consent-blocked"); return false; }
        return true;
    }
    private void loaded(long id) {
        stopTimer(); readyAt = SystemClock.elapsedRealtime(); update("ready", "");
        // 준비된 객체도 TTL이 지나면 정리합니다. 실제 SDK overlay에는 타이머를 적용하지 않습니다.
        timeout = () -> { if (current(id) && state.equals("ready")) fail("expired"); };
        main.postDelayed(timeout, 3300000);
    }

    @PluginMethod public void show(PluginCall call) {
        main.post(() -> {
            if (!guard(call)) return;
            if (TestCommerce.blocksAds(getContext())) { rewards.invalidate(); if (!overlay()) fail("billing-blocked"); call.resolve(snapshot()); return; }
            if (overlay()) { call.resolve(snapshot()); return; }
            expireReady();
            if (!state.equals("ready") || (format.equals("rewarded") ? rewardedAd == null : ad == null)) { call.reject("준비된 광고가 없습니다.", "not-ready"); return; }
            if (!foreground()) { call.reject("앱이 비활성 상태입니다.", "inactive"); return; }
            try {
            if (consent == null || !consent.canRequestAds() || consent.getConsentStatus() == ConsentInformation.ConsentStatus.UNKNOWN) {
                fail("expired"); call.resolve(snapshot()); return;
            }
            final long id = attempt;
            final String requestId = call.getString("requestId");
            if (requestId == null || !requestId.matches("[a-zA-Z0-9-]{16,80}")) { call.reject("표시 요청 식별자가 없습니다.", "request"); return; }
            FullScreenContentCallback callback = new FullScreenContentCallback() {
                @Override public void onAdShowedFullScreenContent() {
                    if (current(id) && state.equals("presenting")) update("showing", "");
                }
                @Override public void onAdDismissedFullScreenContent() {
                    if (!current(id) || !(state.equals("presenting") || state.equals("showing"))) return;
                    // 보상 뒤 권한 철회도 닫힘 시 재확인합니다. 실제 overlay 닫힘만 closed로 기록합니다.
                    try {
                        if (!available() || TestCommerce.blocksAds(getContext()) || consent == null || !consent.canRequestAds()
                            || consent.getConsentStatus() == ConsentInformation.ConsentStatus.UNKNOWN) rewards.invalidate();
                    } catch (Exception ignored) { rewards.invalidate(); }
                    if (format.equals("rewarded")) rewards.close(id);
                    attempt++; stopTimer(); discard(true); update("closed", "");
                }
                @Override public void onAdFailedToShowFullScreenContent(AdError e) { if (current(id) && (state.equals("presenting") || state.equals("showing"))) fail("show:" + e.getCode()); }
            };
            stopTimer();
            if (format.equals("rewarded")) rewardedAd.setFullScreenContentCallback(callback);
            else ad.setFullScreenContentCallback(callback);
            if (format.equals("rewarded") && !rewards.show(id, requestId)) { fail("show-used"); call.resolve(snapshot()); return; }
            update("presenting", "");
            if (format.equals("rewarded")) rewardedAd.show(getActivity(), item -> {
                // Google 광고의 보상→닫힘 순서만 지원합니다. 여기서는 보드를 재개하지 않습니다.
                if (!current(id) || !(state.equals("presenting") || state.equals("showing"))) return;
                try {
                    if (!available() || TestCommerce.blocksAds(getContext()) || consent == null || !consent.canRequestAds()
                        || consent.getConsentStatus() == ConsentInformation.ConsentStatus.UNKNOWN) { rewards.invalidate(); return; }
                    if (rewards.earn(id)) update(state, "");
                } catch (Exception ignored) { rewards.invalidate(); } // 불확실한 실제 overlay를 조기 해제하지 않습니다.
            });
            else ad.show(getActivity());
            } catch (Exception e) { fail("show"); }
            call.resolve(snapshot());
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        main.post(() -> {
            if (!guard(call)) return;
            if (overlay()) { call.resolve(snapshot()); return; }
            attempt++; stopTimer(); discard(); update("cancelled", ""); call.resolve(snapshot());
        });
    }
    @PluginMethod public void privacyOptions(PluginCall call) {
        main.post(() -> {
            if (!guard(call)) return;
            if (TestCommerce.billingOverlay || TestCommerce.billingBusy) { call.resolve(snapshot()); return; }
            if (busy() || !privacyRequired || consent == null || !foreground()) { call.resolve(snapshot()); return; }
            discard(); final long id = ++attempt; update("privacy", "");
            try { UserMessagingPlatform.showPrivacyOptionsForm(getActivity(), formError -> safely(id, () -> {
                if (!current(id) || !state.equals("privacy")) return;
                privacyRequired = consent.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
                if (formError != null) fail("consent:" + formError.getErrorCode());
                else { attempt++; update("idle", ""); } // 양식을 닫아도 광고를 자동 요청하지 않습니다.
            })); } catch (Exception e) { fail("sdk"); }
            call.resolve(snapshot());
        });
    }
    @Override protected void handleOnStop() {
        // 전면 광고/양식이 올린 Activity의 stop은 광고 종료로 오인하지 않습니다.
        if (!overlay() && (busy() || state.equals("ready"))) {
            attempt++; stopTimer(); discard(); update("cancelled", "inactive");
        }
    }
    @Override protected void handleOnDestroy() {
        TestCommerce.adsChanged = null; TestCommerce.adOverlay = false;
        destroyed = true; attempt++; stopTimer(); discard(); main.removeCallbacksAndMessages(null);
        super.handleOnDestroy();
    }
}
