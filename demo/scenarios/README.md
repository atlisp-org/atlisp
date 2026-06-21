# @lisp Usage Scenarios

## Scenario 1: Architectural Drawing Automation

**User**: Architect at a design institute  
**Pain**: Repetitive dimensioning, layer management, and annotation on multi-sheet drawings  
**Solution**: @lisp packages `at-arch`, `at-dim`, `at-layer`

1. Install packages: `@I at-arch` + `@I at-dim`
2. Auto-create standard layers with one command
3. Batch-dimension all openings on current layout
4. Auto-generate door/window schedules

**Result**: 70% reduction in drafting time per project.

---

## Scenario 2: Batch Plotting

**User**: MEP engineering firm  
**Pain**: Plotting 50+ drawings one by one to PDF  
**Solution**: @lisp `at-plot` + `youyun-plot`

1. `@I at-plot`
2. Select all layouts to plot
3. Configure output format (PDF/DWF)
4. One-click batch plot

**Result**: Hours of manual plotting reduced to minutes.

---

## Scenario 3: AI-Assisted LISP Development

**User**: CAD manager writing automation scripts  
**Pain**: Writing AutoLISP from scratch for each new task  
**Solution**: @lisp AI Chat (`C:@C`)

1. `C:@C` to start AI assistant
2. "Create a function that selects all circles on layer 'WALL' and changes their radius to 5"
3. AI generates ready-to-run LISP code
4. Save and reuse

**Result**: LISP development speed increased 5x.
