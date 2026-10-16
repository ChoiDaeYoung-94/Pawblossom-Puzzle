package com.choidaeyoung.pawblossompuzzle;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Collections;
import org.junit.Test;

public class BillingLogicTest {
    @Test public void signedOriginalMustBeExactAndUseConfiguredKey() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        String original = "{\"packageName\":\"test.package\",\"productId\":\"test.product\",\"token\":\"token\",\"purchaseState\":0}";
        Signature signer = Signature.getInstance("SHA1withRSA"); signer.initSign(pair.getPrivate());
        signer.update(original.getBytes(StandardCharsets.UTF_8)); byte[] signature = signer.sign();
        var key = RsaPurchaseSignature.parseKey(pair.getPublic().getEncoded());
        assertTrue(RsaPurchaseSignature.verify(key, original, signature));
        for (String altered : new String[]{original + " ", original.replace("test.package", "other.package"), original.replace("token\"", "other\""), original.replace(":0", ":4")})
            assertFalse(RsaPurchaseSignature.verify(key, altered, signature));
        assertFalse(RsaPurchaseSignature.verify(generator.generateKeyPair().getPublic(), original, signature));
        assertFalse(RsaPurchaseSignature.verify(key, original, new byte[0]));
        assertFalse(RsaPurchaseSignature.verify(null, original, signature));
    }
    @Test public void missingDamagedAndWeakKeysCannotEnableBilling() throws Exception {
        assertNull(RsaPurchaseSignature.parseKey(null)); assertNull(RsaPurchaseSignature.parseKey(new byte[]{1, 2, 3}));
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(1024);
        assertNull(RsaPurchaseSignature.parseKey(generator.generateKeyPair().getPublic().getEncoded()));
    }
    private boolean bound(String pkg, String product, String token, int raw, int sdk, int quantity) {
        return PurchaseBinding.matches("app", "remove", pkg, product, token, raw, "app", Collections.singletonList("remove"), "token", sdk, quantity);
    }
    @Test public void signatureAloneDoesNotProvePackageProductTokenStateOrQuantity() {
        assertTrue(bound("app", "remove", "token", 0, 1, 1));
        assertTrue(bound("app", "remove", "token", 4, 2, 1));
        assertFalse(bound("other", "remove", "token", 0, 1, 1));
        assertFalse(bound("app", "other", "token", 0, 1, 1));
        assertFalse(bound("app", "remove", "", 0, 1, 1));
        assertFalse(bound("app", "remove", "other", 0, 1, 1));
        for (int raw : new int[]{-1, 1, 2, 3, 5}) assertFalse(bound("app", "remove", "token", raw, 1, 1));
        assertFalse(bound("app", "remove", "token", 0, 2, 1));
        assertFalse(bound("app", "remove", "token", 4, 1, 1));
        assertFalse(bound("app", "remove", "token", 0, 1, 2));
    }
    @Test public void pendingNeverGrantsAndCanBecomePurchasedWithSameToken() {
        BillingLedger ledger = new BillingLedger(); ledger.pending(); assertEquals("pending", ledger.entitlement); assertTrue(ledger.blocksAds());
        assertTrue(ledger.purchased("same", false)); assertEquals("owned", ledger.entitlement);
        ledger.pending(); assertEquals("owned", ledger.entitlement);
    }
    @Test public void queryFailurePreservesVerifiedEntitlementButEmptySuccessfulQueryRevokes() {
        BillingLedger ledger = new BillingLedger(); ledger.purchased("token", false); ledger.failed(); assertEquals("owned", ledger.entitlement);
        ledger.queried(false, false, true); assertEquals("owned", ledger.entitlement);
        ledger.queried(false, false, false); ledger.queriedTokens(Collections.emptySet());
        assertEquals("not-owned", ledger.entitlement); assertFalse(ledger.blocksAds());
        assertFalse(ledger.purchased("token", false)); assertEquals("not-owned", ledger.entitlement);
        ledger.pending("token"); assertEquals("not-owned", ledger.entitlement);
        assertTrue(ledger.purchased("token", true)); assertEquals("owned", ledger.entitlement);
    }
    @Test public void failedInitialQueryIsUnknownAndFreshProcessNeverRestoresABoolean() {
        BillingLedger ledger = new BillingLedger(); ledger.failed(); assertEquals("unknown", ledger.entitlement); assertTrue(ledger.blocksAds());
        ledger.queried(false, false, true); assertEquals("unknown", ledger.entitlement);
        ledger.purchased("token", true); assertEquals("unknown", new BillingLedger().entitlement);
    }
    @Test public void acknowledgementsDeduplicateRetryAndIgnoreTimedOutCallback() {
        BillingLedger ledger = new BillingLedger();
        long first = ledger.beginAck("token", false); assertTrue(first > 0); assertEquals(0, ledger.beginAck("token", false));
        assertTrue(ledger.finishAck("token", first, false));
        long retry = ledger.beginAck("token", false); assertTrue(retry > first);
        assertFalse(ledger.finishAck("token", first, true)); assertEquals(0, ledger.beginAck("token", false));
        assertTrue(ledger.finishAck("token", retry, true)); assertEquals(0, ledger.beginAck("token", false));
        assertEquals(0, ledger.beginAck("restored-acknowledged", true));
        ledger.purchased("restored-acknowledged", true); assertEquals("owned", ledger.entitlement);
    }
    @Test public void automaticAcknowledgementBackoffIsBoundedAndResetsOnSuccess() {
        BillingLedger ledger = new BillingLedger();
        assertEquals(2000, ledger.nextAckRetryDelay("token")); assertEquals(6000, ledger.nextAckRetryDelay("token")); assertEquals(0, ledger.nextAckRetryDelay("token"));
        long id = ledger.beginAck("token", false); ledger.finishAck("token", id, true);
        assertEquals(2000, ledger.nextAckRetryDelay("token"));
    }
}
