package com.choidaeyoung.pawblossompuzzle;

import org.junit.Test;
import static org.junit.Assert.*;

public class RewardLedgerTest {
    @Test public void callbackRequiresMatchingShownAttemptAndOnlyCountsOnce() {
        RewardLedger ledger = new RewardLedger();
        assertFalse(ledger.earn(1)); ledger.begin(1);
        assertFalse(ledger.earn(1)); assertFalse(ledger.show(2, "test-request-0000002")); assertTrue(ledger.show(1, "test-request-0000001"));
        assertFalse(ledger.show(1, "test-request-0000001")); assertFalse(ledger.earn(2)); assertTrue(ledger.earn(1));
        assertFalse(ledger.earn(1)); assertEquals(1, ledger.events());
    }
    @Test public void loadShowDismissWithoutRewardDoesNotCount() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); assertTrue(ledger.show(1, "test-request-0000001"));
        ledger.invalidate(); assertFalse(ledger.earn(1)); assertEquals(0, ledger.events());
    }
    @Test public void invalidatedReadyAttemptCannotShowOrEarn() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); ledger.invalidate();
        assertFalse(ledger.show(1, "test-request-0000001")); assertFalse(ledger.earn(1)); assertEquals(0, ledger.events());
    }
    @Test public void newAttemptRejectsLateOldCallbacksAndKeepsRunCount() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); ledger.show(1, "test-request-0000001"); assertTrue(ledger.earn(1));
        ledger.invalidate(); ledger.begin(2); assertFalse(ledger.earn(1)); assertFalse(ledger.show(1, "test-request-0000001"));
        assertTrue(ledger.show(2, "test-request-0000002")); assertFalse(ledger.earn(1)); assertTrue(ledger.earn(2));
        assertFalse(ledger.earn(2)); assertEquals(2, ledger.events());
        assertEquals(0, new RewardLedger().events());
    }
    @Test public void revokedPermissionCannotReenableSameAttempt() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); ledger.show(1, "test-request-0000001"); ledger.invalidate();
        assertFalse(ledger.show(1, "test-request-0000001")); assertFalse(ledger.earn(1));
        ledger.begin(2); assertTrue(ledger.show(2, "test-request-0000002")); assertTrue(ledger.earn(2)); assertEquals(1, ledger.events());
    }
    @Test public void receiptRequiresEarnThenActualCloseAndCannotBeReused() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(7);
        assertFalse(ledger.show(7, null)); assertFalse(ledger.show(7, "bad")); assertNull(ledger.receipt());
        assertTrue(ledger.show(7, "current-request-0007"));
        assertEquals("7", ledger.receipt().attemptId); assertEquals("current-request-0007", ledger.receipt().requestId);
        assertFalse(ledger.receipt().earned); assertFalse(ledger.receipt().closed); assertTrue(ledger.earn(7));
        assertTrue(ledger.receipt().earned); assertFalse(ledger.receipt().closed); assertFalse(ledger.close(6));
        assertTrue(ledger.close(7)); assertTrue(ledger.receipt().closed); assertFalse(ledger.close(7)); assertFalse(ledger.earn(7));
        ledger.begin(8); assertNull(ledger.receipt()); assertFalse(ledger.show(8, "current-request-0007"));
        assertTrue(ledger.show(8, "current-request-0008")); assertTrue(ledger.close(8));
        assertFalse(ledger.earn(8)); assertFalse(ledger.receipt().earned); assertEquals(1, ledger.events());
    }
    @Test public void billingRevocationAfterEarnRemovesReceiptWithoutPretendingOverlayClosed() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(3); ledger.show(3, "current-request-0003"); ledger.earn(3);
        ledger.invalidate(); assertNull(ledger.receipt()); assertFalse(ledger.close(3)); assertEquals(1, ledger.events());
        ledger.begin(4); ledger.show(4, "current-request-0004");
        assertFalse(ledger.earn(3)); assertTrue(ledger.close(4)); assertFalse(ledger.receipt().earned);
    }
}
