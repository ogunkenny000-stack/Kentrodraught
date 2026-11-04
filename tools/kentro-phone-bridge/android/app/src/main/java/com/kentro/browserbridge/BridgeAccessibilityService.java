package com.kentro.browserbridge;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Android controls Chrome on the user's own phone, NOT a second AI model. */
public final class BridgeAccessibilityService extends AccessibilityService {
    private static final String CHANNEL="kentro_remote_control";
    private static final int NOTIFICATION_ID=701;
    private SharedPreferences prefs;
    private CommandLoop queue;
    private Thread worker;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        prefs=getSharedPreferences("kentro_private_v07",Context.MODE_PRIVATE);
        NotificationManager manager=(NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Kentro remote control",NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
            .setContentTitle("Kentro Browser Bridge")
            .setContentText("Phone browser controller active — disable in Settings to stop")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true).build();
        try { startForeground(NOTIFICATION_ID,n); } catch (Exception ignored) { /* May be restricted by Android settings */ }
        try {
            queue=new CommandLoop(this,new DeviceIdentity(this));
            worker=new Thread(queue,"kentro-command-loop");worker.setDaemon(true);worker.start();
        } catch (Exception ignored) { /* Fail closed: no queue if key cannot be read */ }
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* Never collect events passively. */ }
    @Override public void onInterrupt() { }
    @Override public void onDestroy() {
        if(queue!=null)queue.stop();if(worker!=null)worker.interrupt();
        super.onDestroy();
    }
    private static JSONObject response(boolean ok,String message) {
        JSONObject r=new JSONObject();try{r.put("ok",ok);r.put(ok?"message":"error",message);}catch(Exception ignored){}return r;
    }
    private boolean enabled(){return prefs.getBoolean("remote_enabled",false);}
    private String allowedHosts(){return prefs.getString("approved_hosts","aistudio.google.com");}
    private AccessibilityNodeInfo chromeRoot() {
        AccessibilityNodeInfo root=getRootInActiveWindow();
        if(root==null || root.getPackageName()==null ||
            !SafetyRules.BROWSER_PACKAGE.contentEquals(root.getPackageName())) return null;
        return root;
    }
    /** Fail closed unless Chrome exposes an unambiguous HTTPS URL in its address field.
     * A page can navigate after an approved launch; the package name alone is not proof
     * that its current origin remains approved. */
    private boolean verifiedChromeOrigin(AccessibilityNodeInfo root) {
        if (root == null) return false;
        ArrayDeque<AccessibilityNodeInfo> nodes = new ArrayDeque<>();
        nodes.add(root);
        int visited = 0;
        while (!nodes.isEmpty() && visited++ < 450) {
            AccessibilityNodeInfo node = nodes.removeFirst();
            String viewId = node.getViewIdResourceName();
            if ("com.android.chrome:id/url_bar".equals(viewId)) {
                CharSequence value = node.getText();
                if (value == null) return false;
                String shown = value.toString().trim();
                // Do not infer https from a truncated, host-only or elided URL.
                return SafetyRules.approvedUrl(shown, allowedHosts());
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) nodes.addLast(child);
            }
        }
        return false;
    }
    private static String nodeLabel(AccessibilityNodeInfo node) {
        CharSequence t=node.getText();if(t!=null && t.length()>0)return t.toString();
        CharSequence d=node.getContentDescription();return d==null?"":d.toString();
    }
    private JSONArray readNodes(AccessibilityNodeInfo root) {
        JSONArray out=new JSONArray();ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>();q.add(root);
        int seen=0;int chars=0;
        while(!q.isEmpty()&&seen++<250&&chars<9500) {
            AccessibilityNodeInfo n=q.removeFirst();
            String label=n.isPassword()?"[REDACTED PASSWORD FIELD]":
                n.isEditable()?"[EDITABLE FIELD]":nodeLabel(n);
            if(label.length()>240)label=label.substring(0,240);
            // Exclude sensitive input field contents, unless it is explicitly a non-password label.
            if(!label.isEmpty()){
                JSONObject entry=new JSONObject();
                try{entry.put("text",label);entry.put("clickable",n.isClickable());entry.put("editable",n.isEditable());
                    Rect r=new Rect();n.getBoundsInScreen(r);entry.put("bounds",r.toShortString());out.put(entry);chars+=label.length();}
                catch(Exception ignored){}
            }
            for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo child=n.getChild(i);if(child!=null)q.addLast(child);}
        }
        return out;
    }
    private AccessibilityNodeInfo findText(AccessibilityNodeInfo root,String wanted) {
        ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>();q.add(root);int seen=0;
        while(!q.isEmpty()&&seen++<600){
            AccessibilityNodeInfo n=q.removeFirst();
            if(!n.isPassword() && wanted.equalsIgnoreCase(nodeLabel(n).trim())) return n;
            for(int i=0;i<n.getChildCount();i++){ AccessibilityNodeInfo child=n.getChild(i);if(child!=null)q.addLast(child); }
        }
        return null;
    }
    private boolean tapGesture(float x,float y) {
        if(x<0||y<0||x>getResources().getDisplayMetrics().widthPixels||
            y>getResources().getDisplayMetrics().heightPixels)return false;
        Path path=new Path();path.moveTo(x,y);
        GestureDescription g=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,75)).build();
        return dispatchGesture(g,null,null);
    }
    private boolean swipeGesture(boolean down) {
        float w=getResources().getDisplayMetrics().widthPixels;
        float h=getResources().getDisplayMetrics().heightPixels;
        Path path=new Path();path.moveTo(w*.5f,down?h*.3f:h*.75f);
        path.lineTo(w*.5f,down?h*.75f:h*.3f);
        GestureDescription g=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,350)).build();
        return dispatchGesture(g,null,null);
    }
    private static AccessibilityNodeInfo findFocusedEditor(AccessibilityNodeInfo root) {
        AccessibilityNodeInfo n=root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if(n!=null && n.isEditable())return n;
        return null;
    }
    JSONObject perform(String op, JSONObject args) {
        if(!enabled())return response(false,"disabled_on_phone");
        if(!SafetyRules.allowedOperation(op))return response(false,"unsupported_operation");
        if("status".equals(op)) {
            JSONObject r=response(true,"service_active");try{r.put("chrome_visible",chromeRoot()!=null);}catch(Exception ignored){}return r;
        }
        if("navigate".equals(op)) {
            String url=args.optString("url","");
            if(!SafetyRules.approvedUrl(url,allowedHosts()))return response(false,"host_not_approved");
            Intent intent = new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(url));
            intent.setPackage(SafetyRules.BROWSER_PACKAGE);intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try{startActivity(intent);return response(true,"Chrome URL opened");}
            catch(Exception e){return response(false,"chrome_not_available");}
        }
        AccessibilityNodeInfo root=chromeRoot();
        if(root==null)return response(false,"chrome_not_foreground");
        if(!verifiedChromeOrigin(root))return response(false,"chrome_origin_unverified");
        try {
            switch(op) {
                case "read_ui": {
                    JSONObject r=response(true,"Chrome accessibility text");r.put("nodes",readNodes(root));return r;
                }
                case "tap_text": {
                    String target=args.optString("label","");
                    if(!SafetyRules.safeLabel(target))return response(false,"sensitive_or_invalid_label");
                    AccessibilityNodeInfo n=findText(root,target);if(n==null)return response(false,"label_not_found");
                    AccessibilityNodeInfo x=n;int depth=0;
                    while(x!=null&&depth++<5){if(x.isClickable()&&x.performAction(AccessibilityNodeInfo.ACTION_CLICK))return response(true,"clicked_label");x=x.getParent();}
                    Rect b=new Rect();n.getBoundsInScreen(b);
                    if(b.isEmpty()||!tapGesture(b.centerX(),b.centerY()))return response(false,"tap_failed");
                    return response(true,"tap_dispatched");
                }
                case "tap_point": {
                    if(!prefs.getBoolean("allow_point_taps",false))return response(false,"coordinate_taps_disabled");
                    int x=args.optInt("x",-1),y=args.optInt("y",-1);
                    return response(tapGesture(x,y),"coordinate_tap_dispatched");
                }
                case "type_text": {
                    String text=args.optString("text",null);
                    if(!SafetyRules.safeText(text))return response(false,"invalid_text");
                    AccessibilityNodeInfo editor=findFocusedEditor(root);
                    if(editor==null)return response(false,"focus_an_input_first");
                    if(editor.isPassword())return response(false,"password_entry_prohibited");
                    Bundle b=new Bundle();b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,text);
                    return response(editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b),"text_set");
                }
                case "scroll": return response(swipeGesture("down".equals(args.optString("direction","up"))),"scroll_dispatched");
                case "back": return response(performGlobalAction(GLOBAL_ACTION_BACK),"back_dispatched");
                default: return response(false,"unsupported_or_async_action");
            }
        }catch(Exception e){return response(false,"ui_action_error");}
    }
    // Screenshot request begins on the UI thread and completes asynchronously.
    JSONObject captureScreenshotSync() {
        if(!enabled()||!prefs.getBoolean("allow_screenshots",false))return response(false,"screenshots_disabled");
        CountDownLatch latch=new CountDownLatch(1);
        AtomicReference<JSONObject> result=new AtomicReference<>(response(false,"screenshot_failed"));
        main.post(()->{
            AccessibilityNodeInfo root = chromeRoot();
            if(root==null || !verifiedChromeOrigin(root)){result.set(response(false,"chrome_origin_unverified"));latch.countDown();return;}
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(),new TakeScreenshotCallback(){
                @Override public void onSuccess(ScreenshotResult screenshot) {
                    try {
                        HardwareBuffer buffer=screenshot.getHardwareBuffer();
                        Bitmap hw=Bitmap.wrapHardwareBuffer(buffer,screenshot.getColorSpace());
                        if(hw==null)throw new IllegalStateException("no_image");
                        Bitmap copy=hw.copy(Bitmap.Config.ARGB_8888,false);
                        if(copy==null)throw new IllegalStateException("copy_failed");
                        int width=Math.min(720,copy.getWidth());
                        int height=Math.max(1,(int)((double)copy.getHeight()*width/copy.getWidth()));
                        Bitmap small=Bitmap.createScaledBitmap(copy,width,height,true);
                        ByteArrayOutputStream out=new ByteArrayOutputStream();small.compress(Bitmap.CompressFormat.JPEG,35,out);
                        byte[] jpeg=out.toByteArray();
                        small.recycle();copy.recycle();buffer.close();
                        if(jpeg.length>135000)throw new IllegalStateException("image_too_large");
                        JSONObject ok=response(true,"screenshot");
                        ok.put("image_base64",Base64.encodeToString(jpeg,Base64.NO_WRAP));
                        ok.put("mime_type","image/jpeg");result.set(ok);
                    }catch(Exception e){result.set(response(false,"screenshot_encoding_failed"));}
                    latch.countDown();
                }
                @Override public void onFailure(int errorCode) {result.set(response(false,"screenshot_not_allowed"));latch.countDown();}
            });
        });
        try { if(!latch.await(12,TimeUnit.SECONDS)) return response(false,"screenshot_timeout"); }
        catch(InterruptedException e){Thread.currentThread().interrupt();return response(false,"interrupted");}
        return result.get();
    }
}