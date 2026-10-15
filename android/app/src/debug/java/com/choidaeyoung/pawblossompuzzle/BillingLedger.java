package com.choidaeyoung.pawblossompuzzle;

import java.util.HashSet;
import java.util.Set;
import java.util.HashMap;
import java.util.Map;

/** 메모리만 사용합니다. 실패는 미구매로 바꾸지 않으며 성공한 전체 조회만 권한을 해제합니다. */
final class BillingLedger {
    String entitlement = "unknown";
    private final Set<String> acknowledged = new HashSet<>(), ownedTokens = new HashSet<>(), revokedTokens = new HashSet<>();
    private final Map<String, Long> acknowledging = new HashMap<>();
    private final Map<String, Integer> ackRetries = new HashMap<>();
    private long ackRevision = 0;
    boolean purchased(String token, boolean fromQuery) {
        if (!fromQuery && revokedTokens.contains(token)) return false;
        revokedTokens.remove(token); ownedTokens.add(token); purchased(); return true;
    }
    void queriedTokens(Set<String> active) {
        for (String token : ownedTokens) if (!active.contains(token)) revokedTokens.add(token);
        ownedTokens.retainAll(active);
    }
    void purchased() { entitlement = "owned"; }
    void pending() { if (!entitlement.equals("owned")) entitlement = "pending"; }
    void pending(String token) { if (!revokedTokens.contains(token)) pending(); }
    void queried(boolean owned, boolean pending, boolean rejected) {
        if (owned) purchased();
        else if (rejected) failed();
        else entitlement = pending ? "pending" : "not-owned";
    }
    void failed() { if (!entitlement.equals("owned")) entitlement = "unknown"; }
    boolean blocksAds() { return !entitlement.equals("not-owned"); }
    long beginAck(String token, boolean alreadyAcknowledged) {
        if (alreadyAcknowledged) { acknowledged.add(token); acknowledging.remove(token); ackRetries.remove(token); }
        if (acknowledged.contains(token) || acknowledging.containsKey(token)) return 0;
        long id = ++ackRevision; acknowledging.put(token, id); return id;
    }
    boolean finishAck(String token, long id, boolean success) {
        if (!Long.valueOf(id).equals(acknowledging.get(token))) return false;
        acknowledging.remove(token);
        if (success) { acknowledged.add(token); ackRetries.remove(token); }
        return true;
    }
    long nextAckRetryDelay(String token) {
        int count = ackRetries.getOrDefault(token, 0);
        if (count >= 2) return 0;
        ackRetries.put(token, count + 1); return count == 0 ? 2000 : 6000;
    }
}
