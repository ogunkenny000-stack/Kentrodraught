package com.kentro.browserbridge;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.View;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private SharedPreferences prefs;
    private DeviceIdentity identity;
    private LinearLayout container;
    private TextView status;
    private void copy(String value) {
        ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Kentro device enrollment",value));
        status.setText("Copied device enrollment information. Share only the ID and SHA-256 fingerprint, never the token.");
    }
    private void addText(String text, int size) {
        TextView view = new TextView(this);view.setText(text);view.setTextSize(size);view.setTextColor(Color.BLACK);
        view.setPadding(12,14,12,14);container.addView(view);
    }
    private void button(String label, View.OnClickListener l) {
        Button b = new Button(this);b.setText(label);b.setOnClickListener(l);container.addView(b);
    }
    private void toggle(String label,String key,boolean initial) {
        Switch s = new Switch(this);s.setText(label);s.setTextSize(16);s.setChecked(prefs.getBoolean(key,initial));
        s.setOnCheckedChangeListener((button,checked)->{
            prefs.edit().putBoolean(key,checked).apply();
            status.setText("Settings saved. If enabling the controller, also enable Kentro Browser Bridge in Android Accessibility settings.");
        });container.addView(s);
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs=getSharedPreferences("kentro_private_v07",MODE_PRIVATE);
        ScrollView scroll=new ScrollView(this);
        container=new LinearLayout(this);container.setOrientation(LinearLayout.VERTICAL);container.setPadding(22,22,22,22);
        scroll.addView(container);setContentView(scroll);
        addText("Kentro Browser Bridge v0.9.1",24);
        addText("The browser runs on this phone and uses this phone's internet. ChatGPT can queue commands through your connected Supabase project after you enroll this device.",15);
        try {identity = new DeviceIdentity(this);} catch(Exception e){addText("Device key unavailable. Reinstall or contact support. Remote control will remain off.",16);return;}
        String fingerprint;
        try {fingerprint=identity.sha256();}catch(Exception e){fingerprint="Unavailable";}
        final String enrollment="Device ID: "+identity.id+"\nSHA-256 fingerprint: "+fingerprint;
        addText(enrollment,13);
        status=new TextView(this);status.setText("Not connected until the device fingerprint is registered in Supabase.");
        container.addView(status);
        button("Copy enrollment ID + fingerprint", v->copy(enrollment));
        button("Refresh connection status", v->{
            String state=prefs.getString("connection_status","No server connection yet");
            status.setText("Phone connection: "+state+". Enrollment: provide ID + fingerprint only.");
        });
        toggle("Enable remote commands (visible notification)","remote_enabled",false);
        toggle("Allow screenshot commands", "allow_screenshots",false);
        toggle("Allow coordinate tapping", "allow_point_taps",false);
        addText("Approved domains (comma separated). Start with Google AI Studio only:",15);
        EditText hosts=new EditText(this);hosts.setSingleLine(false);hosts.setText(prefs.getString("approved_hosts","aistudio.google.com"));
        container.addView(hosts);
        button("Save approved domains", v->{prefs.edit().putString("approved_hosts",hosts.getText().toString()).apply();status.setText("Approved domains saved.");});
        button("Open Accessibility settings", v->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button("Open Google AI Studio in Chrome", v->{
            Intent i=new Intent(Intent.ACTION_VIEW,android.net.Uri.parse("https://aistudio.google.com/apps"));
            i.setPackage(SafetyRules.BROWSER_PACKAGE);
            try {startActivity(i);}catch(Exception e){status.setText("Chrome is unavailable. Install/enable Chrome.");}
        });
        addText("SECURITY: Use your own Google sign-in in Chrome. Never share your password. Disable Remote Commands or Accessibility access to stop control. All remote actions are limited to Chrome. No banking, payouts or password entry.",14);
    }
}