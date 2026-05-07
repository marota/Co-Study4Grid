# Upstream patch — extra lines to prevent flow increase

## Problem

Co-Study4Grid lets the operator pick **additional lines to prevent flow
increase** beyond the contingency-detected overloads (the
`AdditionalLinesPicker` above the *Analyze & Suggest* button — see the
0.7-line `additional_lines_to_cut` field in `AnalysisStep2Request`).
Today the backend appends those extras into
`lines_overloaded_ids_kept` so the upstream `expert_op4grid_recommender`
treats them as targets for the overflow-graph cut analysis. The
upstream library, however, has **no separate channel** for "lines to
cut but not classified as overload": the same list drives both
`Grid2opSimulation.ltc` (the cut) and the `is_overload` /
`is_monitored` flags rendered in the interactive viewer's *Overloads*
and *Low margin lines* layers.

Consequence: the operator's extras show up under the *Overloads (N)*
filter in the overflow viewer even though they aren't actually
overloaded.

## Fix design

Two patches, one per upstream repo, introduce a dedicated
`extra_lines_to_cut` channel that:

1. Still flows the extras into the simulation (`Grid2opSimulation.ltc`)
   so the cut analysis still sees them.
2. Tags those edges with a new `is_extra_cut=True` graph attribute and
   keeps them out of `is_overload` / `is_monitored`.
3. Renders them with their **natural flow colour** (coral/blue) instead
   of the black + yellow overload styling, while still annotating the
   `before% → 0%` change so the operator sees how their selection
   materialises.
4. Adds a new sidebar layer **"Extra lines to prevent flow increase"**
   (key `semantic:is_extra_cut`, dashed-blue swatch) so the operator
   can still toggle / locate them.

## Patch files

| File | Repo | Description |
|------|------|-------------|
| `ExpertOp4Grid.patch` | [`marota/ExpertOp4Grid`](https://github.com/marota/ExpertOp4Grid) | `OverFlowGraph` accepts `extra_lines_to_cut`, stamps `is_extra_cut`, keeps natural flow colour, skips `is_overload` / `is_monitored` for extras. New `is_extra_cut` layer in the interactive HTML viewer. |
| `Expert_op4grid_recommender.patch` | [`marota/Expert_op4grid_recommender`](https://github.com/marota/Expert_op4grid_recommender) | `build_overflow_graph` (and the pypowsybl/grid2op wrappers) accepts `extra_lines_to_cut_ids`, threads it to the simulation `ltc` and to `OverFlowGraph(extra_lines_to_cut=…)`. `run_analysis_step2_graph` reads `context["extra_lines_to_cut_ids"]` (default `[]`). `make_overflow_graph_visualization` takes the param for plumbing completeness. |

Apply with:

```bash
cd /path/to/ExpertOp4Grid
git checkout -b feat/extra-lines-to-cut
git am < /path/to/Co-Study4Grid/docs/proposals/upstream-extra-lines-to-cut/ExpertOp4Grid.patch

cd /path/to/Expert_op4grid_recommender
git checkout -b feat/extra-lines-to-cut
git am < /path/to/Co-Study4Grid/docs/proposals/upstream-extra-lines-to-cut/Expert_op4grid_recommender.patch
```

## Co-Study4Grid follow-up

Once both upstream patches are released:

1. In `expert_backend/services/analysis_mixin.py::_narrow_context_to_selected_overloads`,
   replace the current append-into-`lines_overloaded_ids_kept` with:
   ```python
   context["extra_lines_to_cut_ids"] = [name_to_idx[n] for n in additional_lines_to_cut if n in name_to_idx]
   ```
   and stop appending into `lines_overloaded_ids` /
   `lines_overloaded_names` / `lines_overloaded_ids_kept`. Keep the
   `lines_we_care_about` re-merge so monitoring stays aligned.
2. Update the `additional_lines_to_cut` test (`test_overload_filtering.py`)
   to assert on `context["extra_lines_to_cut_ids"]` instead of the
   appended overload list.
3. Bump pinned versions in `expert_backend/requirements.txt` /
   `overrides.txt` once the upstream releases land.
4. Drop the manual `additional_lines_to_cut` propagation guard in
   `OverFlowGraph` (kept for backwards-compat with older releases —
   `extra_lines_to_cut` defaults to `None`).

Until then, the current behaviour (extras appear under *Overloads* in
the viewer) is the trade-off; per the agreed plan it's "keep current
development and adapt later".

## Trade-offs / open questions

- **Visual indicator of the cut.** Extras keep their natural flow
  colour, so on a busy graph they're not visually distinct unless the
  operator activates the new *Extra lines to prevent flow increase*
  layer. Acceptable today (the React sidebar already lists them in the
  notice + chips). Could be revisited with a third-colour palette later.
- **Structured-overload graph.** Because extras are no longer
  black-coloured, the `Structured_Overload_Distribution_Graph` won't
  treat them as constrained edges — meaning the *Constrained path*
  layer in the viewer reflects only true overloads. This matches the
  operator's mental model ("extras are monitored, not the contingency
  to resolve") but is worth confirming on a real grid before release.
- **Backwards compatibility.** All new params default to `None` /
  `[]`, so existing callers (any non-cs4g consumer) see no change.
