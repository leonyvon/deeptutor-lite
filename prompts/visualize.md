---
description: Generate a data visualization chart
argument-hint: <chart description>
---
Generate a data visualization chart. $@

Workflow:
1. Retrieve or identify the data to visualize
2. Choose the appropriate chart type (line/bar/histogram/pie/scatter)
3. Write Python matplotlib code and run it with `python_run`
4. Save the chart as a PNG with `plt.savefig("chart_name.png", dpi=150)`
5. Describe the key insights and the file path in FINISH