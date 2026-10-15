package com.choidaeyoung.pawblossompuzzle;

import android.os.Handler;
import android.os.Looper;
import com.android.billingclient.api.*;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/** 광고 제거 한 상품의 debug 전용 실제 Billing 연결. 상품/키/가격 대체값이 없습니다. */
@CapacitorPlugin(name = "PawblossomTestBilling")
public class TestBillingPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private BillingClient client;
    private String state = "idle", error = "", ackError = "", lastNotice = "", price = "";
    private List<String> displayedQuote = Collections.emptyList();
    private final Map<String, Runnable> ackRetries = new HashMap<>();
    private long revision = 0, operation = 0, purchaseRevision = 0;
    private boolean destroyed = false, resumedFromFlow = false, queryAgain = false, preparingPurchase = false;
    private Runnable timeout;

    @Override public void load() { main.post(this::refreshPurchases); }
    private boolean available() { return !destroyed && TestCommerce.enabled(getContext(), "androidTestBilling"); }
    private boolean configured() { return available() && TestCommerce.configured(); }
    private boolean foreground() {
        return getActivity() != null && !getActivity().isFinishing() && !getActivity().isDestroyed() && getBridge().getApp().isActive();
    }
    private boolean busy() { return TestCommerce.billingBusy || TestCommerce.billingOverlay; }
    private JSObject snapshot() {
        JSObject value = new JSObject();
        value.put("available", available()); value.put("configured", configured());
        value.put("state", state); value.put("entitlement", TestCommerce.ledger.entitlement);
        value.put("revision", revision); value.put("error", !error.isEmpty() ? error : !ackError.isEmpty() ? ackError : lastNotice); value.put("price", price);
        value.put("overlay", TestCommerce.billingOverlay); value.put("adsBlocked", TestCommerce.blocksAds(getContext()));
        value.put("preparingPurchase", preparingPurchase);
        return value;
    }
    private void update(String next, String reason) {
        state = next; error = reason; revision++;
        TestCommerce.changed(); notifyListeners("stateChange", snapshot());
    }
    private void stopTimer() { if (timeout != null) main.removeCallbacks(timeout); timeout = null; }
    private void finishOperation() { stopTimer(); operation++; TestCommerce.billingBusy = false; }
    private void failed(String reason) {
        preparingPurchase = false; finishOperation(); price = ""; TestCommerce.ledger.failed(); update("failed", reason);
    }
    private long begin(String next) {
        stopTimer(); long id = ++operation; TestCommerce.billingBusy = true; update(next, "");
        timeout = () -> {
            if (!destroyed && operation == id) {
                // 실제 Play 창이 가린 상태는 종료로 위장하지 않고 복귀에서 다시 조회합니다.
                if (TestCommerce.billingOverlay && !foreground()) return;
                TestCommerce.billingOverlay = false; failed("timeout");
            }
        };
        main.postDelayed(timeout, 45000); return id;
    }
    private boolean current(long id) { return !destroyed && operation == id; }
    private void safely(long id, Runnable action) {
        if (!current(id)) return;
        try { action.run(); } catch (Exception ignored) { TestCommerce.billingOverlay = false; failed("sdk"); }
    }
    private boolean guard() {
        if (!configured()) { update("idle", TestCommerce.specified() ? "configuration" : "unconfigured"); return false; }
        return foreground() && !TestCommerce.adOverlay;
    }
    private void connected(Runnable action) {
        if (!guard() || busy()) return;
        if (client != null && client.isReady()) { action.run(); return; }
        final long id = begin("connecting");
        try {
            if (client == null) client = BillingClient.newBuilder(getContext())
                .setListener((result, purchases) -> main.post(() -> {
                    try { purchasesUpdated(result, purchases); }
                    catch (Exception ignored) { TestCommerce.billingOverlay = false; failed("purchase-response"); }
                }))
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
            client.startConnection(new BillingClientStateListener() {
                @Override public void onBillingSetupFinished(BillingResult result) { main.post(() -> {
                    if (!current(id)) return;
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { failed("connection:" + result.getResponseCode()); return; }
                    finishOperation(); action.run();
                }); }
                @Override public void onBillingServiceDisconnected() { main.post(() -> {
                    if (destroyed) return;
                    if (!TestCommerce.billingOverlay) failed("disconnected");
                    else update("purchasing", "disconnected");
                }); }
            });
        } catch (Exception ignored) { failed("connection"); }
    }
    private void refreshPurchases() {
        if (!guard()) return;
        if (busy()) { queryAgain = true; return; }
        connected(this::queryPurchases);
    }
    private void queryPurchases() {
        if (!guard()) { failed("inactive"); return; }
        queryAgain = false;
        final long id = begin("querying"), observed = purchaseRevision;
        try {
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(), (result, purchases) -> main.post(() -> safely(id, () -> {
                if (!current(id)) return;
                if (observed != purchaseRevision) { finishOperation(); refreshPurchases(); return; }
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null) { failed("query:" + result.getResponseCode()); return; }
                boolean owned = false, pending = false, rejected = false;
                Set<String> active = new HashSet<>();
                List<Purchase> acknowledgements = new ArrayList<>();
                for (Purchase purchase : purchases) {
                    if (!purchase.getProducts().contains(BuildConfig.BILLING_TEST_PRODUCT_ID)) continue;
                    if (!verified(purchase)) { rejected = true; continue; }
                    if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        owned = true; active.add(purchase.getPurchaseToken()); acknowledgements.add(purchase);
                    }
                    else if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) pending = true;
                    else rejected = true;
                }
                TestCommerce.ledger.queried(owned, pending, rejected);
                for (Purchase purchase : acknowledgements) TestCommerce.ledger.purchased(purchase.getPurchaseToken(), true);
                if (!rejected) TestCommerce.ledger.queriedTokens(active);
                if (!rejected && (!owned || acknowledgements.stream().allMatch(Purchase::isAcknowledged))) ackError = "";
                finishOperation(); update("idle", rejected ? "verification" : "");
                for (Purchase purchase : acknowledgements) acknowledge(purchase);
                if (queryAgain) refreshPurchases();
            })));
        } catch (Exception ignored) { failed("query"); }
    }
    private boolean verified(Purchase purchase) {
        try {
            if (!configured() || !RsaPurchaseSignature.verify(TestCommerce.key(), purchase.getOriginalJson(), TestCommerce.decode(purchase.getSignature()))) return false;
            JSONObject signed = new JSONObject(purchase.getOriginalJson());
            String token = signed.optString("token", signed.optString("purchaseToken", ""));
            // SDK 상태는 1=PURCHASED/2=PENDING, 서명 원문의 Play 상태는 0/4입니다.
            Object rawState = signed.get("purchaseState");
            if (!(rawState instanceof Integer)) return false;
            String product = signed.optString("productId", "");
            if (signed.has("productIds")) {
                org.json.JSONArray ids = signed.getJSONArray("productIds");
                if (ids.length() != 1 || (!product.isEmpty() && !product.equals(ids.getString(0)))) return false;
                product = ids.getString(0);
            }
            return PurchaseBinding.matches(getContext().getPackageName(), BuildConfig.BILLING_TEST_PRODUCT_ID,
                signed.getString("packageName"), product, token, (Integer) rawState, purchase.getPackageName(),
                purchase.getProducts(), purchase.getPurchaseToken(), purchase.getPurchaseState(), purchase.getQuantity());
        } catch (Exception ignored) { return false; }
    }
    private void acknowledge(Purchase purchase) {
        String token = purchase.getPurchaseToken();
        if (purchase.isAcknowledged()) ackError = "";
        long ackId = TestCommerce.ledger.beginAck(token, purchase.isAcknowledged());
        if (ackId == 0) return;
        final BillingLedger ledger = TestCommerce.ledger;
        // 타임아웃 후 다음 전체 조회에서 재시도합니다. 같은 토큰 동시 요청은 막습니다.
        final Runnable ackTimeout = () -> {
            if (!destroyed && ledger.finishAck(token, ackId, false)) { ackError = "ack-timeout"; update(state, error); retryAcknowledgement(token); }
        };
        main.postDelayed(ackTimeout, 30000);
        try {
            client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(), result -> main.post(() -> {
                main.removeCallbacks(ackTimeout);
                if (destroyed) return;
                boolean ok = result.getResponseCode() == BillingClient.BillingResponseCode.OK;
                if (ledger.finishAck(token, ackId, ok)) {
                    ackError = ok ? "" : "ack:" + result.getResponseCode(); update(state, error);
                    if (!ok) retryAcknowledgement(token);
                }
            }));
        } catch (Exception ignored) {
            main.removeCallbacks(ackTimeout); ledger.finishAck(token, ackId, false); ackError = "ack"; update(state, error); retryAcknowledgement(token);
        }
    }
    private void retryAcknowledgement(String token) {
        if (ackRetries.containsKey(token)) return;
        long delay = TestCommerce.ledger.nextAckRetryDelay(token);
        if (delay == 0) return;
        Runnable retry = () -> { ackRetries.remove(token); if (!destroyed) refreshPurchases(); };
        ackRetries.put(token, retry); main.postDelayed(retry, delay);
    }
    private void purchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (destroyed || !configured()) return;
        purchaseRevision++; preparingPurchase = false; TestCommerce.billingOverlay = false; resumedFromFlow = false; finishOperation();
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            lastNotice = "";
            boolean rejected = false;
            List<Purchase> acknowledgements = new ArrayList<>();
            for (Purchase purchase : purchases) {
                if (!purchase.getProducts().contains(BuildConfig.BILLING_TEST_PRODUCT_ID)) continue;
                if (!verified(purchase)) { rejected = true; continue; }
                if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED && TestCommerce.ledger.purchased(purchase.getPurchaseToken(), false)) acknowledgements.add(purchase);
                else if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) TestCommerce.ledger.pending(purchase.getPurchaseToken());
            }
            if (rejected) TestCommerce.ledger.failed();
            update("idle", rejected ? "verification" : "");
            for (Purchase purchase : acknowledgements) acknowledge(purchase);
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) { lastNotice = "cancelled"; update("cancelled", ""); }
        else { lastNotice = "purchase:" + code; update("failed", lastNotice); }
        // ITEM_ALREADY_OWNED도 성공으로 위장하지 않고 Play 소유 목록에서 복원합니다.
        refreshPurchases();
    }
    private ProductDetails.OneTimePurchaseOfferDetails permanentOffer(ProductDetails product) {
        List<ProductDetails.OneTimePurchaseOfferDetails> offers = product.getOneTimePurchaseOfferDetailsList();
        if (offers == null || offers.size() != 1) return null;
        ProductDetails.OneTimePurchaseOfferDetails offer = offers.get(0);
        return offer.getRentalDetails() == null && offer.getPreorderDetails() == null && offer.getValidTimeWindow() == null
            && offer.getOfferToken() != null && !offer.getOfferToken().isEmpty() && !offer.getFormattedPrice().isEmpty() ? offer : null;
    }
    private void products(boolean launch) {
        if (!guard()) { failed("inactive"); return; }
        lastNotice = ""; final List<String> expectedQuote = displayedQuote;
        price = ""; final long id = begin("products");
        try {
            client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(
                QueryProductDetailsParams.Product.newBuilder().setProductId(BuildConfig.BILLING_TEST_PRODUCT_ID).setProductType(BillingClient.ProductType.INAPP).build())).build(),
                (result, details) -> main.post(() -> safely(id, () -> {
                    if (!current(id)) return;
                    List<ProductDetails> list = details.getProductDetailsList();
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || list.size() != 1
                        || !BuildConfig.BILLING_TEST_PRODUCT_ID.equals(list.get(0).getProductId()) || !BillingClient.ProductType.INAPP.equals(list.get(0).getProductType())) { failed("product"); return; }
                    ProductDetails product = list.get(0);
                    ProductDetails.OneTimePurchaseOfferDetails offer = permanentOffer(product);
                    if (offer == null) { failed("offer"); return; }
                    price = offer.getFormattedPrice();
                    displayedQuote = Arrays.asList(product.getProductId(), offer.getPurchaseOptionId(), offer.getOfferToken(), offer.getPriceCurrencyCode(), Long.toString(offer.getPriceAmountMicros()), price);
                    finishOperation();
                    if (!launch) { update("idle", ""); if (queryAgain) refreshPurchases(); return; }
                    if (!displayedQuote.equals(expectedQuote)) { preparingPurchase = false; update("idle", "price-changed"); return; }
                    if (!foreground() || TestCommerce.adOverlay || !TestCommerce.ledger.entitlement.equals("not-owned")) { preparingPurchase = false; update("idle", "purchase-blocked"); return; }
                    preparingPurchase = false; TestCommerce.billingOverlay = true; resumedFromFlow = false; begin("purchasing");
                    BillingResult launched = client.launchBillingFlow(getActivity(), BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(
                        BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).setOfferToken(offer.getOfferToken()).build())).build());
                    if (launched.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        TestCommerce.billingOverlay = false; finishOperation();
                        update("failed", "launch:" + launched.getResponseCode());
                        if (launched.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) refreshPurchases();
                    }
                })));
        } catch (Exception ignored) { TestCommerce.billingOverlay = false; failed("product"); }
    }
    @PluginMethod public void getStatus(PluginCall call) { main.post(() -> call.resolve(snapshot())); }
    @PluginMethod public void restore(PluginCall call) { main.post(() -> { lastNotice = ""; refreshPurchases(); call.resolve(snapshot()); }); }
    @PluginMethod public void queryProduct(PluginCall call) { main.post(() -> { connected(() -> products(false)); call.resolve(snapshot()); }); }
    @PluginMethod public void purchase(PluginCall call) { main.post(() -> {
        if (guard() && !busy() && TestCommerce.ledger.entitlement.equals("not-owned") && !price.isEmpty() && !displayedQuote.isEmpty()) {
            preparingPurchase = true; connected(() -> products(true));
        }
        call.resolve(snapshot());
    }); }
    @Override protected void handleOnPause() {
        if (TestCommerce.billingOverlay) resumedFromFlow = true;
        else if (preparingPurchase) failed("inactive"); // 구매 준비가 앱 밖에서 늦게 결제창을 열지 않습니다.
    }
    @Override protected void handleOnResume() {
        main.postDelayed(() -> {
            if (destroyed || !foreground()) return;
            if (TestCommerce.billingOverlay && resumedFromFlow) {
                TestCommerce.billingOverlay = false; resumedFromFlow = false; finishOperation(); update("idle", "rechecking");
            }
            refreshPurchases();
        }, 800);
    }
    @Override protected void handleOnDestroy() {
        destroyed = true; finishOperation(); TestCommerce.billingOverlay = false;
        main.removeCallbacksAndMessages(null); if (client != null) client.endConnection(); super.handleOnDestroy();
    }
}
