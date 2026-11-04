import com.kentro.browserbridge.SafetyRules;
public class SafetyRulesTest {
  static void ok(boolean assertion,String name) {if(!assertion)throw new RuntimeException("FAILED: "+name);System.out.println("PASS " + name);}
  public static void main(String[] args) {
    ok(SafetyRules.approvedUrl("https://aistudio.google.com/apps","aistudio.google.com"),"approved ai studio URL");
    ok(!SafetyRules.approvedUrl("http://aistudio.google.com/","aistudio.google.com"),"reject HTTP");
    ok(!SafetyRules.approvedUrl("https://aistudio.google.com.evil.test/","aistudio.google.com"),"reject suffix domain");
    ok(!SafetyRules.approvedUrl("https://aistudio.google.com@evil.test/","aistudio.google.com"),"reject userinfo attack");
    ok(!SafetyRules.approvedUrl("https://aistudio.google.com:444/apps","aistudio.google.com"),"reject nonstandard port");
    ok(!SafetyRules.safeLabel("Delete my account"),"block account deletion");
    ok(!SafetyRules.safeLabel("Withdraw funds"),"block transfers");
    ok(SafetyRules.safeLabel("Send prompt"),"permit ordinary prompt action");
    ok(!SafetyRules.safeText("x".repeat(2100)),"limit input length");
    ok(!SafetyRules.allowedOperation("run_shell"),"block arbitrary code execution");
  }
}