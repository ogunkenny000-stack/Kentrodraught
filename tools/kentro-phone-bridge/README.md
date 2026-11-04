# Kentro Phone Bridge v0.9.1 — isolated Android build

Builds an Android Chrome Accessibility controller using the phone's internet, with the already-deployed Supabase Edge Function and isolated command queue.

**Limitations:** The APK cannot install itself. Owner must tap Install, enable Android Accessibility and Remote Commands, open Chrome, and copy **only** the Device ID and SHA-256 fingerprint from the app to the assistant for enrollment. **Never send Gmail passwords, device tokens, or OTPs.**

`android/` is a Gradle Android application. Local build if Android SDK and Gradle are available: `cd android && gradle :app:assembleDebug`. GitHub Actions workflow in `.github/workflows/kentro-phone-bridge-apk.yml` builds a debug APK on a separate branch. This debugging package is for testing only; it is not Play Store ready and its ephemeral signing key means another build may not install as an upgrade.

Before granting Accessibility, confirm the APK source and runner are trusted. Disable Remote Commands and the Accessibility service any time. The app only interacts with Chrome, refuses password fields, blocks certain sensitive actions, and requires explicit full HTTPS URL visibility for UI operations, which **may prevent those operations from working** because Chrome can hide the scheme.

The backend does not send browser cookies or passwords; it uses HTTPS from the phone to Supabase. Supabase queue is persistent, but the phone must remain online and its service running.