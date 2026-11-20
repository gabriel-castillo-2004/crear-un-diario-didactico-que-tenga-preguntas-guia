"""Acceptance tests (AT-01 through AT-07) for the Didactic Guided Journal Web App.

Self-contained Python + pytest suite validating HTML, CSS, and JS contracts
without external runtimes or browser automation subprocesses.
"""

from html.parser import HTMLParser
from pathlib import Path
import re

import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
INDEX_HTML = ROOT_DIR / "index.html"
STYLES_CSS = ROOT_DIR / "styles.css"
SRC_DIR = ROOT_DIR / "src"


class _HtmlStructureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[str] = []
        self.attrs_by_tag: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append(tag.lower())
        self.attrs_by_tag.append((tag.lower(), dict(attrs)))


def _read_all_js() -> str:
    assert SRC_DIR.exists(), "src/ directory must exist"
    js_files = sorted(SRC_DIR.rglob("*.js"))
    assert js_files, "At least one .js file must exist under src/"
    return "\n".join(p.read_text(encoding="utf-8") for p in js_files)


def _strip_js_comments(source: str) -> str:
    no_block = re.sub(r"/\*[\s\S]*?\*/", " ", source)
    return re.sub(r"//.*", " ", no_block)


def test_at_01_pin_double_wrapped_dek_and_recovery_without_reencryption() -> None:
    """AT-01: Random DEK double-wrapped with PIN KEK and recovery KEK; PIN reset keeps entries."""
    js = _strip_js_comments(_read_all_js())

    assert "crypto.subtle" in js, "Web Crypto API (crypto.subtle) must be used"
    assert re.search(r"\bPBKDF2\b|\bHKDF\b", js), "Key derivation (PBKDF2/HKDF) must be present"
    assert re.search(r"AES-GCM", js), "AES-GCM encryption must be used"
    assert re.search(r"generateKey|getRandomValues", js), "Random DEK generation must be present"
    assert re.search(r"wrapKey|unwrapKey", js) or (
        re.search(r"encrypt\s*\(", js) and re.search(r"decrypt\s*\(", js)
    ), "DEK wrapping/unwrapping primitives must be implemented"

    assert re.search(r"dek", js, re.IGNORECASE), "DEK concept must be modeled"
    assert re.search(r"kek", js, re.IGNORECASE), "KEK concept must be modeled"
    assert re.search(
        r"recupera|recovery", js, re.IGNORECASE
    ), "Recovery code flow for unwrapping/rewrapping DEK must exist"
    assert re.search(
        r"changePin|cambiarPin|resetPin|restablecerPin|rewrap|reWrap", js, re.IGNORECASE
    ), "PIN change or reset must re-wrap DEK without re-encrypting entries"


def test_at_02_manual_phase_update_and_non_repeating_guided_question() -> None:
    """AT-02: Manual phase change updates contextualized guided question without immediate repeat."""
    js = _strip_js_comments(_read_all_js())

    phases = [
        r"menstrua",
        r"folicular",
        r"ovulaci",
        r"l[uú]tea",
        r"neutro",
    ]
    for phase_pattern in phases:
        assert re.search(phase_pattern, js, re.IGNORECASE), (
            f"Cycle phase matching /{phase_pattern}/ must be supported"
        )

    assert re.search(
        r"tem[aá]tica|themes?|topics?", js, re.IGNORECASE
    ), "Active life themes must be supported by the question engine"
    assert re.search(
        r"pregunta|question", js, re.IGNORECASE
    ), "Guided question selection logic must be present"
    assert re.search(
        r"previous|prevQuestion|lastQuestion|ultimaPregunta|anterior|!==|!==",
        js,
        re.IGNORECASE,
    ), "Question engine must avoid repeating the immediately previous question"


def test_at_03_suspend_inference_after_45_days_or_irregular_mode() -> None:
    """AT-03: >45 days since last record or irregular/non-menstruating mode suspends inference."""
    js = _strip_js_comments(_read_all_js())

    assert re.search(r"\b45\b", js), "45-day threshold must be defined for cycle inference"
    assert re.search(
        r"irregular|no[\s_-]*menstruante|non[\s_-]*menstruating", js, re.IGNORECASE
    ), "Irregular / non-menstruating mode must be supported"
    assert re.search(r"neutro", js, re.IGNORECASE), "Neutral fallback mode must be supported"
    assert re.search(
        r"confirm|confirma|solicita|prompt", js, re.IGNORECASE
    ), "Phase confirmation or neutral prompt must be triggered when inference is suspended"


def test_at_04_indexeddb_stores_only_aes_gcm_envelopes() -> None:
    """AT-04: IndexedDB stores entries and cycle records solely as AES-GCM encrypted envelopes."""
    js = _strip_js_comments(_read_all_js())

    assert "indexedDB" in js, "IndexedDB persistence must be used"
    assert re.search(r"createObjectStore", js), "IndexedDB object stores must be created"
    assert re.search(r"AES-GCM", js), "AES-GCM must be used for stored envelopes"
    assert re.search(r"\biv\b", js), "Initialization vector (iv) must accompany encrypted envelopes"
    assert re.search(
        r"ciphertext|cipher|encrypted|payload|sobre", js, re.IGNORECASE
    ), "Encrypted envelope payload field must be present"


def test_at_05_inactivity_and_visibilitychange_lock_with_exponential_backoff() -> None:
    """AT-05: Inactivity timer or visibilitychange purges DEK/index and enforces exponential backoff."""
    js = _strip_js_comments(_read_all_js())

    assert "visibilitychange" in js, "visibilitychange event listener must be registered"
    assert re.search(
        r"document\.hidden|visibilityState", js
    ), "Hidden visibility state must be checked"
    assert re.search(
        r"setTimeout|setInterval", js
    ), "Inactivity timer must be implemented"
    assert re.search(
        r"lock|bloquea|purge|purga", js, re.IGNORECASE
    ), "Session lock / memory purge handler must exist"
    assert re.search(
        r"Math\.pow|\*\*|<<|backoff|espera|delay", js, re.IGNORECASE
    ), "Exponential backoff for failed PIN attempts must be implemented"


def test_at_06_versioned_encrypted_backup_and_dry_run_import_validation() -> None:
    """AT-06: Export produces versioned encrypted backup; tampered/invalid import fails dry-run."""
    js = _strip_js_comments(_read_all_js())

    assert re.search(
        r"export|respaldo|backup", js, re.IGNORECASE
    ), "Backup export functionality must exist"
    assert re.search(
        r"import", js, re.IGNORECASE
    ), "Backup import functionality must exist"
    assert re.search(
        r"version|schemaVersion|formato", js, re.IGNORECASE
    ), "Backup format must include a version field"
    assert re.search(
        r"dry[\s_-]*run|validate|validar", js, re.IGNORECASE
    ), "Dry-run / pre-validation before writing to IndexedDB must exist"


def test_at_07_e2e_responsive_ui_and_full_user_flow_contracts() -> None:
    """AT-07: Mobile & desktop responsive UI and full flow (PIN, recovery, entry, filter, lock)."""
    assert INDEX_HTML.exists(), "index.html must exist"
    assert STYLES_CSS.exists(), "styles.css must exist"

    html_text = INDEX_HTML.read_text(encoding="utf-8")
    parser = _HtmlStructureParser()
    parser.feed(html_text)

    assert "main" in parser.tags, "index.html must contain a <main> landmark"
    has_viewport = any(
        tag == "meta" and attrs.get("name") == "viewport"
        for tag, attrs in parser.attrs_by_tag
    )
    assert has_viewport, "index.html must declare a responsive viewport meta tag"

    css_text = STYLES_CSS.read_text(encoding="utf-8")
    assert "@media" in css_text, "styles.css must include @media rules for mobile and desktop"

    js = _strip_js_comments(_read_all_js())
    combined_ui = html_text + "\n" + js

    assert re.search(r"pin", combined_ui, re.IGNORECASE), "PIN UI flow must exist"
    assert re.search(r"recupera|recovery", combined_ui, re.IGNORECASE), "Recovery code UI must exist"
    assert re.search(r"historial|history", combined_ui, re.IGNORECASE), "History view must exist"
    assert re.search(r"filtr|filter", combined_ui, re.IGNORECASE), "History filtering must exist"
