---
name: deeptutor-visualize
description: Generate data visualizations using Python matplotlib. Activates when the user requests charts, graphs, plots, or data visualization.
---

# Data Visualization

Generate charts using Python matplotlib via the `python_run` tool.

## Workflow

1. **Understand data**: Identify what to visualize — retrieve data from KB with `knowledge_search` or from user input.
2. **Choose chart type**:
   - Trends → line chart (`plt.plot`)
   - Comparisons → bar chart (`plt.bar`)
   - Distribution → histogram (`plt.hist`)
   - Composition → pie chart (`plt.pie`)
   - Correlation → scatter plot (`plt.scatter`)
3. **Write Python code** using `python_run`:
   ```python
   import matplotlib.pyplot as plt
   # ... data preparation ...
   plt.figure(figsize=(10, 6))
   plt.plot(x, y, marker='o')
   plt.title("Chart Title")
   plt.xlabel("X Label")
   plt.ylabel("Y Label")
   plt.grid(True, alpha=0.3)
   plt.tight_layout()
   plt.savefig("chart_name.png", dpi=150)
   print("Chart saved to: chart_name.png")
   ```
4. **Save as PNG**: Use `plt.savefig()` with a descriptive filename.
5. **Report**: In FINISH, describe key insights and the file path.

## Code Guidelines
- Use `plt.style.use('seaborn-v0_8-darkgrid')` for clean aesthetics.
- Always set `figsize`, `title`, axis labels, and grid.
- Handle missing data gracefully.
- If matplotlib is not installed: `pip install matplotlib pandas`.
