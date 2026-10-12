"""Server half of the browser-parity fixtures in
frontend/src/features/datasets/lib/__tests__/cutover-dataset-editing.test.ts.

The React wizard detects CSV encodings and slugifies names itself; its Vitest
fixtures hold the bytes below and expect the labels asserted here, so the two
sides cannot drift apart.
"""

import pytest

from qym_platform.api.datasets import _decode_csv, _slugify

ENCODING_FIXTURES = [
    ("arabic header and body", "c7e1d3c4c7e12cc7e1c5ccc7c8c90ae3c720e5ed20dac7d5e3c920c7e1e3e3e1dfc920c7e1dad1c8edc920c7e1d3dae6cfedc9bf2cc7e1d1edc7d60adfe320dacfcf20c3edc7e320c7e1c3d3c8e6dabf2cd3c8dac90a", "windows-1256"),
    ("persian", "712c610a81d1d3d4208dedd3cabf2c90d2c7d1d4208ed1dd0a", "windows-1256"),
    ("french semicolon", "7175657374696f6e3b616e737765720a436166e93f3b4372e86d65206272fb6ce9650ac7612076613f3b5472e873206269656e0a", "windows-1252"),
    ("german", "712c610a4772fcdf6520617573206465722053747261df652c536368f66e0a", "windows-1252"),
    ("spanish", "712c610a5365f16f722c20bf63f36d6f20657374e13f2c4d7579206269656e0a", "windows-1252"),
    ("a-grave", "712c610a496c2068616269746520e0204c6f6e647265732e2c4f75690a", "windows-1252"),
    ("a-grave 2", "712c610a456c6c6520766120e0206c27e9636f6c6520e020706965642e2c4f75690a", "windows-1252"),
    ("multiplication sign", "712c610a3220d720332c360a", "windows-1252"),
    ("not sign", "712c610aac502c767261690a", "windows-1252"),
    ("short arabic", "712c610ac7e1d4c7ed20e620c7e1dee5e6c92ce4dae30a", "windows-1256"),
    ("ascii", "712c610a706c61696e2061736369692c6f6e6c790a", "utf-8"),
]


@pytest.mark.parametrize("name,hex_bytes,label", ENCODING_FIXTURES)
def test_server_reports_the_encoding_the_browser_fixtures_expect(name, hex_bytes, label):
    _, server_label = _decode_csv(bytes.fromhex(hex_bytes))
    assert server_label == label


@pytest.mark.parametrize(
    "name,slug",
    [
        ("Customer Support QA!", "customer-support-qa"),
        ("snake_case name", "snake-case-name"),
        ("بيانات التقييم", "بيانات-التقييم"),
        ("قيِّم", "قيِّم"),
        ("Café crème", "café-crème"),
        ("  a -- b  ", "a-b"),
    ],
)
def test_server_slugs_match_the_browser_fixtures(name, slug):
    assert _slugify(name) == slug
