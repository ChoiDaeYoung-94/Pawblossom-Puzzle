package com.choidaeyoung.pawblossompuzzle;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;

/** Play의 signed 원문에만 적용합니다. 서버 검증·환불 조회를 대신하지 않습니다. */
final class RsaPurchaseSignature {
    static PublicKey parseKey(byte[] value) {
        try {
            if (value == null || value.length == 0 || value.length > 4096) return null;
            PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(value));
            return key instanceof RSAPublicKey && ((RSAPublicKey) key).getModulus().bitLength() >= 2048 ? key : null;
        } catch (Exception ignored) { return null; }
    }
    static boolean verify(PublicKey key, String original, byte[] signature) {
        try {
            if (key == null || original == null || original.isEmpty() || original.length() > 65536 || signature == null || signature.length == 0) return false;
            Signature verifier = Signature.getInstance("SHA1withRSA");
            verifier.initVerify(key);
            verifier.update(original.getBytes(StandardCharsets.UTF_8));
            return verifier.verify(signature);
        } catch (Exception ignored) { return false; }
    }
}
