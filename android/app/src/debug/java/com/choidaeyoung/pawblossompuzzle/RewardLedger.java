package com.choidaeyoung.pawblossompuzzle;

/** main thread 전용. 현재 plugin 실행의 SDK 콜백 수이며 게임 지급/저장과 연결하지 않습니다. */
final class RewardLedger {
    private long attempt = -1;
    private boolean active = false, showing = false, earned = false;
    private int events = 0;
    void begin(long id) { attempt = id; active = true; showing = false; earned = false; }
    boolean show(long id) {
        if (!active || attempt != id || showing) return false;
        showing = true;
        return true;
    }
    boolean earn(long id) {
        if (!active || attempt != id || !showing || earned || events == Integer.MAX_VALUE) return false;
        earned = true;
        events++;
        return true;
    }
    void invalidate() { active = false; showing = false; }
    int events() { return events; }
}
