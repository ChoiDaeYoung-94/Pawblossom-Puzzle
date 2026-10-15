package com.choidaeyoung.pawblossompuzzle;

import com.getcapacitor.BridgeActivity;

final class TestAdsRegistration {
    static void register(BridgeActivity activity) {
        activity.registerPlugin(TestAdsPlugin.class);
    }
}
