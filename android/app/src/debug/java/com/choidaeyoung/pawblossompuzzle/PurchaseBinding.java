package com.choidaeyoung.pawblossompuzzle;

import java.util.Collections;
import java.util.List;

/** 서명을 통과한 원문의 필드와 SDK 해석을 한 상품·한 패키지·한 토큰에 묶습니다. */
final class PurchaseBinding {
    static boolean matches(String expectedPackage, String expectedProduct, String signedPackage, String signedProduct,
        String signedToken, int rawState, String sdkPackage, List<String> sdkProducts, String sdkToken, int sdkState, int quantity) {
        return expectedPackage.equals(signedPackage) && expectedPackage.equals(sdkPackage)
            && expectedProduct.equals(signedProduct) && Collections.singletonList(expectedProduct).equals(sdkProducts)
            && signedToken != null && !signedToken.isEmpty() && signedToken.equals(sdkToken) && quantity == 1
            && ((rawState == 0 && sdkState == 1) || (rawState == 4 && sdkState == 2));
    }
}
