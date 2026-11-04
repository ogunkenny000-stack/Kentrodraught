package com.kentro.browserbridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class DeviceIdentity {
    private static final String KEYSTORE_ALIAS = "kentro_phone_bridge_v07";
    private final SharedPreferences prefs;
    final String id;
    final String token;

    DeviceIdentity(Context context) throws Exception {
        prefs = context.getSharedPreferences("kentro_private_v07", Context.MODE_PRIVATE);
        String storedId = prefs.getString("device_id", null);
        String ciphertext = prefs.getString("encrypted_device_key", null);
        if (storedId != null && ciphertext != null) {
            // If the keystore is invalidated we fail closed: no silent token replacement.
            id = storedId;
            token = decrypt(ciphertext);
        } else {
            id = UUID.randomUUID().toString();
            byte[] random = new byte[48];
            new SecureRandom().nextBytes(random);
            token = Base64.encodeToString(random, Base64.NO_WRAP | Base64.NO_PADDING | Base64.URL_SAFE);
            prefs.edit().putString("device_id",id).putString("encrypted_device_key",encrypt(token)).apply();
        }
    }
    String sha256() throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if (ks.containsAlias(KEYSTORE_ALIAS)) return (SecretKey)ks.getKey(KEYSTORE_ALIAS,null);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return kg.generateKey();
    }
    private String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] nonce = cipher.getIV(), encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] raw = new byte[nonce.length+encrypted.length];
        System.arraycopy(nonce,0,raw,0,nonce.length);System.arraycopy(encrypted,0,raw,nonce.length,encrypted.length);
        return Base64.encodeToString(raw, Base64.NO_WRAP);
    }
    private String decrypt(String saved) throws Exception {
        byte[] raw = Base64.decode(saved,Base64.NO_WRAP);
        if (raw.length < 29) throw new SecurityException("Invalid encrypted key");
        byte[] nonce = java.util.Arrays.copyOfRange(raw,0,12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,nonce));
        return new String(cipher.doFinal(raw,12,raw.length-12), StandardCharsets.UTF_8);
    }
}