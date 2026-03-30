# Architecture Proposal: Spatial Level-of-Detail (LoD) Rendering

This document outlines the implementation strategy for the **Option C + Spatial Filtering** approach to solve the frontend UI freeze when navigating massive power grid topologies (e.g., grids with > 1,000 lines or 500+ nodes). 

## 🎯 The Core Concept
Instead of rendering the entire 14MB SVG with 100,000+ DOM nodes, the application will:
1. Generate a **Macro Layout** (entire grid, but heavily simplified) for the default 1x zoom view.
2. Track the user's viewport using `react-zoom-pan-pinch`.
3. When the user zooms in past `2.0x`, calculate the visible **Bounding Box (BBox)**, expand it by a 5-10x buffer, and fetch a **Micro Layout** (highly detailed SVG) containing *only* the voltage levels inside that padded box.
4. Seamlessly swap the Macro SVG with the localized Micro SVG.

---

## 🏗️ 1. Backend Implementation

### A. The New API Endpoint
We will create a new endpoint dedicated to bounding-box queries:
`POST /api/diagram-bbox`

**Payload Model:**
```python
class BBoxDiagramRequest(BaseModel):
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    disconnected_element: str | None = None
```

### B. Spatial Filtering via `grid_layout.json`
Inside `recommender_service.py`, the backend already loads `grid_layout.json` into a pandas DataFrame (`self._load_layout()`). We will use this DataFrame to dynamically identify all Voltage Levels (VLs) that fall within the requested BBox:

```python
def _get_vls_in_bbox(self, x_min, x_max, y_min, y_max):
    df = self._load_layout()
    if df is None: return None
    
    # Fast spatial filter
    visible = df[
        (df['x'] >= x_min) & (df['x'] <= x_max) &
        (df['y'] >= y_min) & (df['y'] <= y_max)
    ]
    return visible.index.tolist()
```

### C. Leveraging PyPowSyBl
Once we have the list of `visible_vl_ids`, we pass them directly into PyPowSyBl's diagram generator. Because we provide the specific IDs, PyPowSyBl will automatically prune the rest of the grid:

```python
diagram = network.get_network_area_diagram(
    voltage_level_ids=visible_vl_ids,
    depth=0, # or 1 to show edges leading out of the BBox
    # ...
)
```
**Impact**: The SVG payload generated is tiny (typically < 500KB) and takes milliseconds to transmit and parse.

---

## 🖥️ 2. Frontend Implementation

### A. Tracking the Viewport
In `VisualizationPanel.tsx`, we intercept the transformation state from the zoom/pan library.
```typescript
import { useTransformContext } from 'react-zoom-pan-pinch';

// Inside a child component wrapped by TransformComponent:
const { transformState } = useTransformContext();
const { scale, positionX, positionY } = transformState;
```

### B. Debouncing the Request
Since panning triggers 60 state updates per second, we must **debounce** the API call so it only fires 300-500ms *after* the user stops moving the mouse.

### C. Calculating the Buffered BBox
When the debounce triggers (and `scale > 2.0`), we calculate the physical coordinates:
1. Map screen `(0,0)` to SVG `(x1, y1)`.
2. Map screen `(width, height)` to SVG `(x2, y2)`.
3. Apply a **Multiplier (e.g., 5x)** to extend this box in all directions. This buffer ensures that if the user pans slightly to the left or right, they don't immediately encounter empty space.

### D. The Seamless DOM Swap
To prevent a jarring white flash (FOUC - Flash of Unstyled Content) when the newly fetched Micro SVG replaces the Macro SVG:
1. We hold the Micro SVG in standard state (`diagramMicroSvg`).
2. Both SVGs are rendered in the DOM, but the new one is temporarily hidden.
3. Once the browser has painted the new Micro SVG DOM nodes, we hide the Macro SVG.

---

## 🚦 Execution Roadmap (Phases)

| Phase | Task | Effort | 
| :--- | :--- | :--- |
| **1. Backend** | Create `POST /api/diagram-bbox` and pandas spatial filter in `recommender_service.py`. | 1 Day |
| **2. Backend** | Implement `Macro` generator mode (strip text/borders via `lxml` for full-grid view). | 0.5 Days |
| **3. Frontend** | Implement `useViewBoxTracker` hook to calculate BBox mapped to SVG coordinates from the zoom state. | 1 Day |
| **4. Frontend** | Implement Debounce fetching logic and state swapping. | 1 Day |
| **5. Integration** | Handle Edge Cases (e.g., panning outside the 5x buffer forces a new tile fetch). | 1 Day |

This architecture fundamentally pivots the application from a "load everything" monolith to a dynamic mapping engine, permanently resolving SVG DOM limits.
