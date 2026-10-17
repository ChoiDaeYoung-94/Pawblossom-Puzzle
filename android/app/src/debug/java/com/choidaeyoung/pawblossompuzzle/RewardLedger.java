package com.choidaeyoung.pawblossompuzzle;

/** main thread 전용. Google earn→dismiss 순서의 표시별 사실만 전달하며 지급/저장은 웹에서 판단합니다. */
final class RewardLedger {
    static final class Receipt {
        final String requestId, attemptId;
        final boolean earned, closed;
        Receipt(String requestId, long attempt, boolean earned, boolean closed) {
            this.requestId = requestId; this.attemptId = Long.toString(attempt); this.earned = earned; this.closed = closed;
        }
    }
    private long attempt = -1;
    private boolean active = false, showing = false, earned = false, closed = false;
    private String requestId;
    private final java.util.Set<String> usedRequests = new java.util.HashSet<>();
    private int events = 0;
    void begin(long id) { attempt = id; active = true; showing = false; earned = false; closed = false; requestId = null; }
    boolean show(long id, String request) {
        if (!active || attempt != id || showing || request == null || !request.matches("[a-zA-Z0-9-]{16,80}") || usedRequests.size() >= 2048 || !usedRequests.add(request)) return false;
        showing = true; requestId = request;
        return true;
    }
    boolean earn(long id) {
        if (!active || attempt != id || !showing || earned || events == Integer.MAX_VALUE) return false;
        earned = true;
        events++;
        return true;
    }
    boolean close(long id) {
        if (!active || attempt != id || !showing || closed) return false;
        active = false; closed = true;
        return true;
    }
    Receipt receipt() { return requestId == null ? null : new Receipt(requestId, attempt, earned, closed); }
    void invalidate() { active = false; showing = false; requestId = null; closed = false; earned = false; }
    int events() { return events; }
}
