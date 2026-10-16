package com.choidaeyoung.pawblossompuzzle;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        TestAdsRegistration.register(this);
        super.onCreate(savedInstanceState);
    }
}
