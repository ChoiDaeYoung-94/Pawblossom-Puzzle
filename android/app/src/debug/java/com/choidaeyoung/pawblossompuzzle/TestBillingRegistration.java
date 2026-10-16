package com.choidaeyoung.pawblossompuzzle;

import com.getcapacitor.BridgeActivity;

final class TestBillingRegistration {
    static void register(BridgeActivity activity) {
        TestCommerce.reset(activity);
        activity.registerPlugin(TestBillingPlugin.class);
    }
}
