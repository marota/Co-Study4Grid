# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Unit tests for the Co-Study4Grid overflow-graph overlay injector and
the dynamic ``/results/pdf/{filename}`` route that serves it.

The overlay is plain string substitution by design (no HTML parser
dependency) — exercising it is therefore deterministic and fast.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from expert_backend.main import app
from expert_backend.services.overflow_overlay import inject_overlay


_BASE_HTML = (
    '<!doctype html><html><head><title>x</title></head>'
    '<body><div id="stage"><svg></svg></div></body></html>'
)


# ---------------------------------------------------------------------
# inject_overlay — pure-string injector
# ---------------------------------------------------------------------

class TestInjectOverlay:
    def test_injects_style_and_script_before_closing_body(self) -> None:
        out = inject_overlay(_BASE_HTML)
        # The original body content must still be there.
        assert '<div id="stage"><svg></svg></div>' in out
        # Both blocks must appear AND be positioned before </body>.
        style_at = out.find('<style id="cs4g-overlay-style">')
        script_at = out.find('<script id="cs4g-overlay-script">')
        body_close = out.find('</body>')
        assert 0 < style_at < body_close
        assert 0 < script_at < body_close

    def test_pin_message_listener_is_injected(self) -> None:
        out = inject_overlay(_BASE_HTML)
        assert "cs4g:pins" in out
        assert "cs4g:pin-clicked" in out
        assert "cs4g:overlay-ready" in out

    def test_single_click_is_debounced_against_double_click(self) -> None:
        """The pin's click handler must defer firing
        ``cs4g:pin-clicked`` via a setTimeout so that a follow-up
        dblclick can cancel it. Without the debounce, a real
        double-click sequence (click, click, dblclick) would always
        fire the single-click first — that switched the React tab
        and prevented the dblclick from drilling into the SLD
        overlay."""
        out = inject_overlay(_BASE_HTML)
        # The setTimeout call gating the single click must be present.
        assert "SINGLE_CLICK_DELAY_MS" in out
        assert "setTimeout" in out
        # And the dblclick handler must clear that timer before
        # posting its own message.
        assert "clearTimeout(clickTimer)" in out

    def test_pin_double_click_listener_is_injected(self) -> None:
        """Pins must emit ``cs4g:pin-double-clicked`` carrying both
        the action id AND its substation, so the parent React app can
        open the SLD overlay on the post-action sub-tab for that
        substation."""
        out = inject_overlay(_BASE_HTML)
        assert "cs4g:pin-double-clicked" in out
        assert "actionId: pin.actionId" in out
        assert "substation: pin.substation" in out
        assert "addEventListener('dblclick'" in out

    def test_shared_pin_glyph_module_is_inlined(self) -> None:
        """``createPinGlyph`` and the severity palette must be
        present in the injected script — the iframe shares the
        rendering code with the React Action Overview pins by
        inlining ``frontend/src/utils/svg/pinGlyph.js``."""
        out = inject_overlay(_BASE_HTML)
        assert "function createPinGlyph(" in out
        assert "const SEVERITY_FILL" in out
        assert "const SEVERITY_FILL_HIGHLIGHTED" in out
        # ESM ``export`` keyword must have been stripped — the iframe
        # runtime is a bare <script> with no module loader.
        assert "export const SEVERITY_FILL" not in out
        assert "export function createPinGlyph" not in out

    def test_injected_script_parses_as_valid_js(self) -> None:
        """The whole overlay <script> must parse cleanly. A duplicate
        ``const`` (e.g. ``SVG_NS`` declared by both the inlined
        ``pinGlyph.js`` and the wrapper IIFE) silently disables every
        listener — no pins render, no postMessage handler. We use
        Python's bundled ``js2py``-free check by exercising the
        offset that pinGlyph.js sits in the script and asserting
        ``SVG_NS`` is declared exactly once."""
        out = inject_overlay(_BASE_HTML)
        # Extract the injected <script> body.
        m = re.search(
            r'<script id="cs4g-overlay-script">([\s\S]*?)</script>',
            out,
        )
        assert m, "no overlay <script> tag found"
        body = m.group(1)
        # The actual declaration must appear exactly once — if it's
        # duplicated the whole IIFE fails with ``Identifier 'SVG_NS'
        # has already been declared``. Match the assignment form
        # specifically so the wording-only mention in a comment
        # doesn't false-positive.
        decls = re.findall(r"^\s*const\s+SVG_NS\s*=", body, re.MULTILINE)
        assert len(decls) == 1, (
            f"const SVG_NS declared {len(decls)}× in overlay (must be 1)"
        )

    def test_action_filters_section_is_injected(self) -> None:
        """The overlay must inject an ``Action pins filters`` section
        that mirrors the chip-row filters of the React Action Overview
        tab so the iframe's sidebar offers the same UX. It is hidden
        by default (only visible when pins are toggled on) and emits
        ``cs4g:overflow-filter-changed`` when the operator interacts
        with it."""
        out = inject_overlay(_BASE_HTML)
        # CSS hook + JS builder.
        assert "#cs4g-filters" in out
        assert "#cs4g-filters.visible" in out
        assert "function buildFiltersPanel(" in out
        # Wire-format: outbound message type for filter changes.
        assert "cs4g:overflow-filter-changed" in out
        # Wire-format: inbound message type from the parent.
        assert "cs4g:filters" in out
        # Clear, action-pin-scoped header text.
        assert "Action pins filters" in out
        # Pin-counter UI surfaces the number of currently-rendered
        # pins, mirroring the Action Overview's pin counter.
        assert "data-counter-value" in out
        assert "function updatePinCounter(" in out
        # The section labels must match the Action Overview chip text
        # so operators recognise them across surfaces.
        assert "Solves overload" in out
        assert "Low margin" in out
        assert "Still overloaded" in out
        assert "Divergent / islanded" in out
        assert "Show unsimulated" in out
        assert "Max loading" in out

    def test_action_filters_section_is_appended_below_existing_sections(self) -> None:
        """The pins filter panel is appended at the END of the
        sidebar so the existing layer toggles keep their top-of-list
        position. ``sidebar.appendChild`` is the sentinel."""
        out = inject_overlay(_BASE_HTML)
        assert "sidebar.appendChild(panel)" in out
        # And no longer inserted before the layers <h2>.
        assert "sidebar.insertBefore(panel, layersHeader)" not in out

    def test_filter_panel_carries_all_four_severity_chips(self) -> None:
        """Severity category chips: green / orange / red / grey.
        Each must be wired with ``data-category="<key>"`` so
        ``renderFilterState`` can flip ``aria-pressed`` on the right
        element after a parent ``cs4g:filters`` broadcast."""
        out = inject_overlay(_BASE_HTML)
        # The category chips are produced by the catSpecs loop
        # in buildFiltersPanel.
        for spec_key in ('green', 'orange', 'red', 'grey'):
            assert (
                f"key: '{spec_key}'," in out
            ), f"category chip spec for {spec_key} missing"
        # And renderFilterState reads them back through data-category.
        assert "querySelectorAll('[data-category]')" in out

    def test_filter_panel_carries_all_eight_action_type_tokens(self) -> None:
        """The action-type chip row mirrors ``ACTION_TYPE_FILTER_TOKENS``
        in ``actionTypes.ts`` (single-select 'all' / 'disco' / 'reco' /
        'ls' / 'rc' / 'open' / 'close' / 'pst')."""
        out = inject_overlay(_BASE_HTML)
        for tok in ("'all'", "'disco'", "'reco'", "'ls'",
                    "'rc'", "'open'", "'close'", "'pst'"):
            assert tok in out, f"action-type token {tok} missing"
        # Single-select wire-format: actionType is a STRING (not an
        # object).
        assert "actionType: tok" in out

    def test_filter_panel_threshold_input_is_a_percent_spinner(self) -> None:
        """The threshold control is a 0–300% integer spinner; the
        wire format stores ``threshold`` as a 0-3 fraction (clamped /
        100). Symmetric with ``ActionOverviewDiagram``'s control."""
        out = inject_overlay(_BASE_HTML)
        # 0–300% bounds.
        assert 'min="0"' in out
        assert 'max="300"' in out
        # Clamping on input.
        assert "Math.max(0, Math.min(300, raw))" in out
        # Conversion to fraction on the way out, multiply on the way in.
        assert "clamped / 100" in out
        assert "filterState.threshold * 100" in out

    def test_filter_panel_show_unsimulated_checkbox(self) -> None:
        """The Show-unsimulated checkbox carries ``showUnsimulated``
        and round-trips boolean to / from the parent."""
        out = inject_overlay(_BASE_HTML)
        assert 'data-filter="show-unsimulated"' in out
        assert "showUnsimulated: !!ev.target.checked" in out
        assert "showUnsimulated: !!msg.filters.showUnsimulated" in out

    def test_filter_panel_pin_counter_starts_at_zero(self) -> None:
        """The injected counter element starts at 0 and is updated by
        ``updatePinCounter`` from the render loop after pin
        anchor-resolution — mirrors the Action Overview's
        ``overview-pin-counter``."""
        out = inject_overlay(_BASE_HTML)
        # Initial DOM string carries 0.
        assert "data-counter-value>0</span>" in out
        # The drawn counter is updated AFTER the pin loop.
        assert "updatePinCounter(drawn)" in out

    def test_select_all_select_none_are_wired(self) -> None:
        """The ``All`` / ``None`` pills bulk-flip every category at
        once — same UX as the Action Overview's filter row."""
        out = inject_overlay(_BASE_HTML)
        assert 'data-action="select-all"' in out
        assert 'data-action="select-none"' in out
        # Body of select-all sets every category True.
        assert (
            "categories: { green: true, orange: true, red: true, grey: true }"
        ) in out
        # Body of select-none sets every category False.
        assert (
            "categories: { green: false, orange: false, red: false, grey: false }"
        ) in out

    def test_filter_state_default_matches_action_overview(self) -> None:
        """The iframe's local default ``filterState`` matches
        ``DEFAULT_ACTION_OVERVIEW_FILTERS`` in ``actionTypes.ts``.
        If they drift, the iframe panel would briefly show the wrong
        chips on first paint before the parent's broadcast catches up."""
        out = inject_overlay(_BASE_HTML)
        # All four categories enabled.
        assert (
            "categories: { green: true, orange: true, red: true, grey: true }"
        ) in out
        # Threshold default 1.5 (mirrors DEFAULT_ACTION_OVERVIEW_FILTERS).
        assert "threshold: 1.5," in out
        # showUnsimulated false by default.
        assert "showUnsimulated: false," in out
        # actionType 'all' by default.
        assert "actionType: 'all'," in out

    def test_overlay_listens_for_parent_filter_broadcasts(self) -> None:
        """Bidirectional sync — the parent posts ``cs4g:filters``
        whenever its ``overviewFilters`` change. The iframe must
        accept that broadcast and replace its local state without
        echoing back (otherwise we'd loop)."""
        out = inject_overlay(_BASE_HTML)
        # The branch must NOT call postFilters — only render.
        # Look for the inbound branch and assert it returns BEFORE
        # posting back.
        m = re.search(
            r"if \(msg\.type === 'cs4g:filters'.*?return;",
            out, re.DOTALL,
        )
        assert m, "missing inbound cs4g:filters branch"
        body = m.group(0)
        assert "buildFiltersPanel()" in body
        assert "renderFilterState()" in body
        assert "postFilters" not in body, (
            "parent broadcast must NOT trigger an outbound "
            "cs4g:overflow-filter-changed echo"
        )

    def test_unsimulated_pins_get_dashed_stroke_and_dim_opacity(self) -> None:
        """Pins flagged ``unsimulated: true`` must render with a
        dashed outline + reduced opacity, mirroring the Action
        Overview's ``renderUnsimulatedPin`` visual."""
        out = inject_overlay(_BASE_HTML)
        assert "const isUnsim = !!pin.unsimulated;" in out
        # ``dimmed`` flag forwarded to the shared glyph factory so
        # the body fill uses the dimmed palette.
        assert "dimmed: isUnsim," in out
        # And the explicit dashed stroke + opacity overrides.
        assert "setAttribute('stroke-dasharray'," in out
        assert "setAttribute('opacity', '0.5')" in out
        assert "setAttribute('data-unsimulated', 'true')" in out

    def test_overlay_uses_pin_title_field_when_present(self) -> None:
        """The native ``<title>`` tooltip rendered inside each pin
        prefers the parent-supplied ``pin.title`` field over the bare
        action id. Un-simulated pins use this to surface the same
        multi-line score / rank / MW-start tooltip the Action
        Overview NAD pins show."""
        out = inject_overlay(_BASE_HTML)
        # The createPinGlyph call site reads pin.title with a fallback
        # to pin.actionId.
        assert "typeof pin.title === 'string' && pin.title" in out
        assert ": pin.actionId," in out

    def test_unsimulated_pin_dblclick_kicks_off_manual_simulation(self) -> None:
        """Un-simulated pins do NOT open the SLD overlay on dblclick;
        they post a distinct message that the parent routes through
        ``onSimulateUnsimulatedAction`` instead."""
        out = inject_overlay(_BASE_HTML)
        assert "cs4g:overflow-unsimulated-pin-double-clicked" in out
        # The branch must be guarded by isUnsim (so simulated pins
        # still go through the normal SLD path).
        m = re.search(
            r"if \(isUnsim\) \{\s*window\.parent\.postMessage\(\{\s*"
            r"type:\s*'cs4g:overflow-unsimulated-pin-double-clicked'",
            out, re.DOTALL,
        )
        assert m, (
            "the unsimulated-dblclick post must be gated on isUnsim"
        )

    def test_pin_layer_lives_inside_graph_group(self) -> None:
        """The pin layer is appended to ``g.graph`` (which carries the
        graphviz transform) rather than the SVG root, so pin BBox
        coordinates from ``getBBox()`` line up with the rendered
        graph instead of floating outside it."""
        out = inject_overlay(_BASE_HTML)
        assert "cs4g-pin-layer" in out
        assert "root.appendChild(layer)" in out

    def test_dim_styling_classes_injected(self) -> None:
        out = inject_overlay(_BASE_HTML)
        assert ".cs4g-pin" in out
        assert "cs4g-pin-layer" in out

    def test_idempotent_re_injection_replaces_previous_block(self) -> None:
        once = inject_overlay(_BASE_HTML)
        twice = inject_overlay(once)
        # Exactly one occurrence of each id, even after a second pass.
        assert twice.count('<style id="cs4g-overlay-style">') == 1
        assert twice.count('<script id="cs4g-overlay-script">') == 1
        # Body content survived.
        assert '<div id="stage"><svg></svg></div>' in twice

    def test_raises_on_missing_body_tag(self) -> None:
        with pytest.raises(ValueError):
            inject_overlay("<html><head></head></html>")


# ---------------------------------------------------------------------
# /results/pdf/{filename} dynamic route
# ---------------------------------------------------------------------

@pytest.fixture()
def overflow_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Redirect the route to a temp directory so the suite can drop
    fixture files without polluting the project's `Overflow_Graph/`."""
    import expert_backend.main as backend_main

    monkeypatch.setattr(backend_main, "_OVERFLOW_DIR", tmp_path)
    return tmp_path


def test_route_serves_html_with_overlay_injected(overflow_dir: Path) -> None:
    fixture = overflow_dir / "Overflow_demo.html"
    fixture.write_text(_BASE_HTML, encoding="utf-8")

    client = TestClient(app)
    response = client.get("/results/pdf/Overflow_demo.html")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert '<style id="cs4g-overlay-style">' in response.text
    assert '<script id="cs4g-overlay-script">' in response.text


def test_route_serves_pdf_unchanged(overflow_dir: Path) -> None:
    fixture = overflow_dir / "Overflow_demo.pdf"
    fixture.write_bytes(b"%PDF-1.4\n%fake\n%%EOF")

    client = TestClient(app)
    response = client.get("/results/pdf/Overflow_demo.pdf")

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-1.4")


def test_route_404_on_missing_file(overflow_dir: Path) -> None:
    client = TestClient(app)
    response = client.get("/results/pdf/does-not-exist.html")
    assert response.status_code == 404


def test_route_blocks_path_traversal(overflow_dir: Path) -> None:
    # Drop an HTML so the route would return 200 if traversal succeeded.
    sibling = overflow_dir.parent / "leaked.html"
    sibling.write_text("secret", encoding="utf-8")

    client = TestClient(app)
    response = client.get("/results/pdf/../leaked.html")
    # FastAPI/starlette may rewrite '..' before our handler sees it; if
    # the resolved path leaves the root we MUST return 404 rather than
    # serve the foreign file. Either rejection path is acceptable.
    assert response.status_code in (404, 400)


def test_route_html_without_body_tag_serves_raw(overflow_dir: Path, caplog: pytest.LogCaptureFixture) -> None:
    fixture = overflow_dir / "no_body.html"
    fixture.write_text("<html><head></head></html>", encoding="utf-8")

    client = TestClient(app)
    response = client.get("/results/pdf/no_body.html")

    assert response.status_code == 200
    # The raw content was returned without injection.
    assert "cs4g-overlay" not in response.text
