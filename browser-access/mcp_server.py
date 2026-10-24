#!/usr/bin/env python3
"""MCP stdio adapter for the private local Kaggle browser controller.

Run a browser session first with browser_tool.py. This adapter does not create
platform tools, a public endpoint, an interactive desktop, or a login form.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

import browser_tool

DESCRIPTIONS = {
    'status': ('Read browser state without exposing authentication values.', {}),
    'navigate': ('Open an HTTPS Kaggle URL. Authentication pages require manual sign-in.', {'url': 'string'}),
    'snapshot': ('Read the current non-authentication page and visible control labels.', {}),
    'click': ('Click a Kaggle control on a non-authentication page.', {'selector': 'string'}),
    'fill': ('Enter ordinary non-secret text on a non-authentication page.', {'selector': 'string', 'value': 'string'}),
    'select': ('Choose an option on a non-authentication page.', {'selector': 'string', 'value': 'string'}),
    'upload': ('Upload a staged artifact; private browser/session files cannot be uploaded.', {'selector': 'string', 'path': 'string'}),
    'download': ('Click a download control and preserve its artifact without overwriting.', {'selector': 'string', 'name': 'string'}),
    'screenshot': ('Save a screenshot of a non-authentication page.', {'name': 'string'}),
    'stop': ('Close this browser session, preserving its private profile.', {}),
}


def tools():
    return [dict(name='kaggle_browser_' + action, description=description,
                 inputSchema=dict(type='object', properties={key: dict(type=kind)
                     for key, kind in fields.items()}, required=list(fields), additionalProperties=False))
            for action, (description, fields) in DESCRIPTIONS.items()]


async def dispatch(message, state):
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return dict(jsonrpc='2.0', id=None, error=dict(code=-32600, message='Invalid JSON-RPC request'))
    if 'id' not in message:
        return None
    result = None
    method = message.get('method')
    if method == 'initialize':
        requested = message.get('params', {}).get('protocolVersion')
        protocol = requested if requested in ['2024-11-05', '2025-03-26', '2025-06-18'] else '2025-06-18'
        result = dict(protocolVersion=protocol,
                      capabilities=dict(tools=dict(listChanged=False)),
                      serverInfo=dict(name='kaggle-browser-bridge', version='1.0.0'))
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = dict(tools=tools())
    elif method == 'tools/call':
        params = message.get('params', {})
        name = params.get('name', '')
        action = name.removeprefix('kaggle_browser_')
        if not name.startswith('kaggle_browser_') or action not in DESCRIPTIONS:
            return dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32602, message='Unknown browser tool'))
        arguments = params.get('arguments', {})
        fields = DESCRIPTIONS[action][1]
        if not isinstance(arguments, dict) or set(arguments) != set(fields) or any(not isinstance(v, str) for v in arguments.values()):
            return dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32602, message='Invalid tool arguments'))
        try:
            value = await browser_tool.request(state, dict(action=action, **arguments))
        except Exception as error:
            value = browser_tool.safe_error(error)
        result = dict(content=[dict(type='text', text=json.dumps(value))],
                      structuredContent=value, isError=not value.get('ok', False))
    else:
        return dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32601, message='Method not found'))
    return dict(jsonrpc='2.0', id=message['id'], result=result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=Path(__file__).resolve().parent / '.state')
    args = parser.parse_args()
    for line in sys.stdin:
        try:
            if len(line) > browser_tool.MAX_MESSAGE:
                raise ValueError('Request too large')
            message = json.loads(line)
            response = asyncio.run(dispatch(message, args.state_dir.resolve()))
        except Exception:
            response = dict(jsonrpc='2.0', id=None, error=dict(code=-32700, message='Invalid request'))
        if response is not None:
            print(json.dumps(response), flush=True)


if __name__ == '__main__':
    main()
