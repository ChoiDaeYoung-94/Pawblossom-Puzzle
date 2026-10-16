package com.choidaeyoung.pawblossompuzzle;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import org.json.JSONObject;

/** main thread 전용. 광고/결제 SDK가 JS를 거치지 않고도 동일한 차단 상태를 확인합니다. */
final class TestCommerce {
    static BillingLedger ledger = new BillingLedger();
    static boolean billingOverlay = false, adOverlay = false, billingBusy = false;
    static Runnable adsChanged;
    static boolean enabled(Context context, String flag) {
        try (var stream = context.getAssets().open("public/build-info.json")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[256]; int count;
            while ((count = stream.read(chunk)) != -1) { buffer.write(chunk, 0, count); if (buffer.size() > 4096) return false; }
            byte[] bytes = buffer.toByteArray();
            JSONObject info = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0
                && Boolean.TRUE.equals(info.opt("testTools")) && Boolean.TRUE.equals(info.opt(flag));
        } catch (Exception ignored) { return false; }
    }
    static boolean specified() { return !BuildConfig.BILLING_TEST_PRODUCT_ID.isEmpty() || !BuildConfig.BILLING_TEST_PUBLIC_KEY.isEmpty(); }
    static byte[] decode(String value) {
        try {
            if (value == null || value.isEmpty() || value.length() > 4096 || !value.matches("[A-Za-z0-9+/]+={0,2}")) return null;
            byte[] decoded = Base64.decode(value, Base64.NO_WRAP);
            return Base64.encodeToString(decoded, Base64.NO_WRAP).equals(value) ? decoded : null;
        } catch (Exception ignored) { return null; }
    }
    static PublicKey key() { return RsaPurchaseSignature.parseKey(decode(BuildConfig.BILLING_TEST_PUBLIC_KEY)); }
    static boolean configured() { return BuildConfig.BILLING_TEST_PERMANENT_PRODUCT && BuildConfig.BILLING_TEST_PRODUCT_ID.matches("[a-z0-9][a-z0-9_.]{0,199}") && key() != null; }
    static boolean blocksAds(Context context) {
        return billingOverlay || billingBusy || (enabled(context, "androidTestBilling") && specified() && (!configured() || ledger.blocksAds()));
    }
    static void changed() { if (adsChanged != null) adsChanged.run(); }
    static void reset(Context context) {
        ledger = new BillingLedger(); billingOverlay = false; adOverlay = false; billingBusy = false; adsChanged = null;
    }
}
