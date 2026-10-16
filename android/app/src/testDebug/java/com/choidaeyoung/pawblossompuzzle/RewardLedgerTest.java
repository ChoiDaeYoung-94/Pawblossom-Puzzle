package com.choidaeyoung.pawblossompuzzle;

import org.junit.Test;
import static org.junit.Assert.*;

public class RewardLedgerTest {
    @Test public void callbackRequiresMatchingShownAttemptAndOnlyCountsOnce() {
        RewardLedger ledger = new RewardLedger();
        assertFalse(ledger.earn(1)); ledger.begin(1);
        assertFalse(ledger.earn(1)); assertFalse(ledger.show(2)); assertTrue(ledger.show(1));
        assertFalse(ledger.show(1)); assertFalse(ledger.earn(2)); assertTrue(ledger.earn(1));
        assertFalse(ledger.earn(1)); assertEquals(1, ledger.events());
    }
    @Test public void loadShowDismissWithoutRewardDoesNotCount() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); assertTrue(ledger.show(1));
        ledger.invalidate(); assertFalse(ledger.earn(1)); assertEquals(0, ledger.events());
    }
    @Test public void invalidatedReadyAttemptCannotShowOrEarn() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); ledger.invalidate();
        assertFalse(ledger.show(1)); assertFalse(ledger.earn(1)); assertEquals(0, ledger.events());
    }
    @Test public void newAttemptRejectsLateOldCallbacksAndKeepsRunCount() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); ledger.show(1); assertTrue(ledger.earn(1));
        ledger.invalidate(); ledger.begin(2); assertFalse(ledger.earn(1)); assertFalse(ledger.show(1));
        assertTrue(ledger.show(2)); assertFalse(ledger.earn(1)); assertTrue(ledger.earn(2));
        assertFalse(ledger.earn(2)); assertEquals(2, ledger.events());
        assertEquals(0, new RewardLedger().events());
    }
    @Test public void revokedPermissionCannotReenableSameAttempt() {
        RewardLedger ledger = new RewardLedger(); ledger.begin(1); ledger.show(1); ledger.invalidate();
        assertFalse(ledger.show(1)); assertFalse(ledger.earn(1));
        ledger.begin(2); assertTrue(ledger.show(2)); assertTrue(ledger.earn(2)); assertEquals(1, ledger.events());
    }
}
