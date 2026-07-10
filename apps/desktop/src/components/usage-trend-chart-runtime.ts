import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function createUsageTrendChart(container: HTMLDivElement): EChartsType {
  return init(container, undefined, { renderer: "canvas" });
}
