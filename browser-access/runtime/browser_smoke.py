#!/usr/bin/env python3
"""Unauthenticated normal-TLS Chromium smoke; never disables the browser sandbox."""
import asyncio
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from playwright.async_api import async_playwright


def proxy():
    value = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if not value:
        return None
    parsed = urlsplit(value)
    if not parsed.hostname or parsed.scheme not in ['http', 'https']:
        raise RuntimeError('Unsupported configured proxy.')
    result = dict(server=f'{parsed.scheme}://{parsed.hostname}' + (f':{parsed.port}' if parsed.port else ''))
    if parsed.username:
        result['username'] = parsed.username
    if parsed.password:
        result['password'] = parsed.password
    return result


async def main():
    result = dict(authenticated=False, browser_tested=False, tls_tested=False,
                  target='https://www.kaggle.com/account/login', ignore_https_errors=False,
                  chromium_sandbox=True, setuid_helper_disabled=True)
    output = Path('/browser-state/browser-smoke.json')
    try:
        async with async_playwright() as runtime:
            browser = await runtime.chromium.launch_persistent_context(
                '/browser-state/smoke-profile', executable_path='/usr/bin/chromium',
                chromium_sandbox=True, headless=True, ignore_https_errors=False,
                args=['--disable-setuid-sandbox'], proxy=proxy(), timeout=20000)
            try:
                diagnostic = await browser.new_page()
                await diagnostic.goto('chrome://sandbox')
                text = await diagnostic.locator('body').inner_text()
                result['sandbox_diagnostic'] = text
                result['namespace_sandbox_reported'] = bool(re.search(r'(Namespace Sandbox|PID namespaces)\s+Yes', text, re.I))
                result['seccomp_sandbox_reported'] = bool(re.search(r'Seccomp.BPF sandbox\s+Yes', text, re.I))
                if not result['namespace_sandbox_reported'] or not result['seccomp_sandbox_reported']:
                    raise RuntimeError('Chromium did not report both namespace and seccomp sandbox protection.')
                page = await browser.new_page()
                response = await page.goto(result['target'], wait_until='domcontentloaded', timeout=20000)
                result.update(browser_tested=True, tls_tested=True,
                              http_status=response.status if response else None, title=await page.title(),
                              url=page.url.split('?', 1)[0].split('#', 1)[0], state='passed')
                if result['http_status'] != 200:
                    raise RuntimeError('Kaggle public navigation did not return HTTP200.')
            finally:
                await browser.close()
    except Exception as error:
        # Only fixed classifications leave this process. Launch errors can
        # contain full command lines, so never publish their raw text.
        detail = str(error).lower()
        reasons = [('pthread_create', 'thread_creation_failed'),
                   ('failed to move to new namespace', 'namespace_creation_denied'),
                   ('failed to enter new namespace', 'namespace_creation_denied'),
                   ('no usable sandbox', 'sandbox_unavailable'),
                   ('err_cert', 'tls_certificate_rejected'),
                   ('err_tunnel_connection_failed', 'configured_proxy_failed'),
                   ('executable doesn', 'browser_executable_missing'),
                   ('error while loading shared libraries', 'shared_library_missing'),
                   ('operation not permitted', 'kernel_permission_denied')]
        reason = next((name for pattern, name in reasons if pattern in detail), 'unclassified_browser_failure')
        # Before any account page has loaded, retain only browser stderr, never
        # launch command lines, environment or arbitrary exception text.
        stderr = re.findall(r'\[pid=\d+\]\[err\]\s*([^\r\n]{1,500})', str(error))[:12]
        deny = re.compile(r'password|authorization|bearer\s|cookie|private.?key|token|https?://[^\s/@]+:[^\s/@]+@', re.I)
        stderr = [line for line in stderr if not deny.search(line)]
        exits = re.findall(r'signal=(SIG[A-Z]+)', str(error))
        result.update(state='failed', error_type=type(error).__name__,
                      failure_reason=reason,
                      prelogin_browser_stderr=stderr,
                      browser_exit_signal=exits[-1] if exits else None,
                      message='Normal sandbox or verified HTTPS smoke failed; no fallback was used.')
        output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
        raise SystemExit(1)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    asyncio.run(main())
