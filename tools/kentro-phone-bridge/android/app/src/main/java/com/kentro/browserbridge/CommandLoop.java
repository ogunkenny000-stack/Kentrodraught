package com.kentro.browserbridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Internet-connected queue client: only outbound HTTPS, no phone ports and no Gmail password. */
final class CommandLoop implements Runnable {
    private static final String ENDPOINT="https://pwovowlyylceuzontdhg.supabase.co/functions/v1/kentro-phone-bridge-v08";
    private final BridgeAccessibilityService accessibility;
    private final DeviceIdentity identity;
    private final SharedPreferences prefs;
    private volatile boolean running=true;
    private final Handler main = new Handler(Looper.getMainLooper());
    CommandLoop(BridgeAccessibilityService service,DeviceIdentity identity) {
        this.accessibility=service;this.identity=identity;
        this.prefs=service.getSharedPreferences("kentro_private_v07", Context.MODE_PRIVATE);
    }
    void stop(){running=false;}
    private void setStatus(String status) {
        // Human-readable status only; never store access tokens, page text or credentials.
        prefs.edit().putString("connection_status",status).apply();
    }
    private JSONObject post(JSONObject payload) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(ENDPOINT).openConnection();
        try {
            c.setRequestMethod("POST");c.setConnectTimeout(8000);c.setReadTimeout(18000);c.setDoOutput(true);
            c.setRequestProperty("Content-Type","application/json");
            c.setRequestProperty("X-Kentro-Device",identity.id);
            c.setRequestProperty("X-Kentro-Token",identity.token);
            byte[] bytes=payload.toString().getBytes(StandardCharsets.UTF_8);
            if(bytes.length>200000)throw new IOException("Response body too large");
            try(OutputStream out=c.getOutputStream()){out.write(bytes);}
            int status=c.getResponseCode();
            if(status>=400)throw new IOException("Bridge HTTP error "+status);
            try(InputStream stream=c.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192]; int n;
                while ((n = stream.read(chunk)) != -1) {
                    if (buffer.size() + n > 235000) throw new IOException("Oversized bridge response");
                    buffer.write(chunk, 0, n);
                }
                byte[] data = buffer.toByteArray();
                return new JSONObject(new String(data,StandardCharsets.UTF_8));
            }
        } finally { c.disconnect(); }
    }
    private JSONObject mainAction(String op,JSONObject args) throws Exception {
        if ("screenshot".equals(op)) return accessibility.captureScreenshotSync();
        CountDownLatch latch=new CountDownLatch(1);
        AtomicReference<JSONObject> ref=new AtomicReference<>();
        main.post(()->{try { ref.set(accessibility.perform(op,args)); }
            catch(Exception e){ref.set(error("action_failed"));} finally {latch.countDown();}});
        if(!latch.await(25,TimeUnit.SECONDS))return error("action_timeout");
        return ref.get()==null?error("no_result"):ref.get();
    }
    private static JSONObject error(String e) {
        JSONObject o=new JSONObject(); try{o.put("error",e);}catch(Exception ignored){}return o;
    }
    private void checkpoint(String id,String status) {
        // Atomic, secret-free, minimal recovery note. Queue is the persistent source of truth.
        File tmp = new File(accessibility.getFilesDir(),"bridge_checkpoint.tmp");
        File dst = new File(accessibility.getFilesDir(),"bridge_checkpoint.json");
        try(FileOutputStream out = new FileOutputStream(tmp)) {
            JSONObject o=new JSONObject();o.put("command_id",id);o.put("state",status);o.put("updated_at_ms",System.currentTimeMillis());
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();
            if(!tmp.renameTo(dst)) throw new IOException("rename failed");
        } catch(Exception ignored) { /* Queue still durable in Supabase. */ }
    }
    @Override public void run() {
        int errors=0;
        long lastHeartbeat=0;
        while(running) {
            try {
                if(!prefs.getBoolean("remote_enabled",false)) { setStatus("Remote commands disabled"); Thread.sleep(1000);continue; }
                if(System.currentTimeMillis()-lastHeartbeat>30000) {
                    JSONObject hb=post(new JSONObject().put("action","heartbeat"));
                    if(hb.optBoolean("ok",false)) { lastHeartbeat=System.currentTimeMillis(); setStatus("Connected to bridge; polling commands"); }
                    else throw new IOException("Device not enrolled");
                }
                JSONObject response=post(new JSONObject().put("action","claim"));
                if(!response.optBoolean("ok",false))throw new IOException("Claim rejected");
                JSONObject command=response.optJSONObject("command");
                if(command==null){Thread.sleep(1000);errors=0;continue;}
                String id=command.optString("id", ""),op=command.optString("operation", "");
                JSONObject args=command.optJSONObject("args");if(args==null)args=new JSONObject();
                checkpoint(id,"running");
                JSONObject result=mainAction(op,args);
                boolean success=result.optBoolean("ok",false);
                checkpoint(id,success?"succeeded_local":"failed_local");
                JSONObject completion=new JSONObject().put("action","complete").put("command_id",id)
                    .put("success",success).put("result",result);
                post(completion);
                checkpoint(id,success?"acknowledged":"failed_acknowledged");
                setStatus(success?"Last command acknowledged":"Last command returned an error");
                errors=0;
            } catch(InterruptedException e){Thread.currentThread().interrupt();break;}
            catch(Exception e){
                // Never retain raw exceptions: they can contain URLs or other private values.
                setStatus("Waiting for bridge or device enrollment (connection error)");
                errors=Math.min(errors+1,6);
                try{Thread.sleep(Math.min(30000,1000L<<errors));}catch(InterruptedException interrupted){break;}
            }
        }
    }
}