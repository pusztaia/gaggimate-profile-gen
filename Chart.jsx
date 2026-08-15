import { useEffect, useRef } from 'preact/hooks';
import { Chart } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(annotationPlugin);

function withPluginDefaults(options = {}) {
  return {
    ...options,
    plugins: {
      // Dragging stays disabled for every chart unless a chart explicitly
      // supplies a dragData configuration (the radar does).
      dragData: false,
      ...(options.plugins ?? {}),
    },
  };
}

function getPath(root, path) {
  return path.reduce((value, key) => value?.[key], root);
}

function setExistingFontSize(root, path, size) {
  const target = getPath(root, path);
  if (!target) return;
  target.font ??= {};
  target.font.size = size;
}

export function ChartComponent({ data, className, chartClassName }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // Create exactly one Chart.js instance for this canvas.
  useEffect(() => {
    if (!canvasRef.current) return undefined;

    const chart = new Chart(canvasRef.current, {
      ...data,
      options: withPluginDefaults(data.options),
    });

    chartRef.current = chart;

    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  // Update the existing instance instead of remounting it. Preserve legend
  // visibility across data refreshes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const hiddenDatasets = chart.data.datasets.map((_, index) =>
      chart.getDatasetMeta(index).hidden
    );

    chart.data = data.data;
    chart.options = withPluginDefaults(data.options);

    chart.data.datasets.forEach((_, index) => {
      if (hiddenDatasets[index] !== undefined) {
        chart.getDatasetMeta(index).hidden = hiddenDatasets[index];
      }
    });

    chart.update('none');
  }, [data]);

  // Responsive typography without creating scale definitions that do not
  // belong to the chart. This is especially important for radar charts: the
  // old helper created x/y/y1 scales during resize and could trigger Cartesian
  // fallback artefacts.
  useEffect(() => {
    const handleResize = () => {
      const chart = chartRef.current;
      if (!chart) return;

      const small = window.innerWidth < 640;
      const options = chart.options;

      setExistingFontSize(options, ['plugins', 'legend', 'labels'], small ? 10 : 12);
      setExistingFontSize(options, ['plugins', 'title'], small ? 14 : 16);

      // Cartesian charts.
      setExistingFontSize(options, ['scales', 'x', 'ticks'], small ? 10 : 12);
      setExistingFontSize(options, ['scales', 'y', 'ticks'], small ? 10 : 12);
      setExistingFontSize(options, ['scales', 'y1', 'ticks'], small ? 10 : 12);

      const xTicks = getPath(options, ['scales', 'x', 'ticks']);
      if (xTicks) xTicks.maxTicksLimit = small ? 5 : 10;

      // Radar charts.
      setExistingFontSize(options, ['scales', 'r', 'ticks'], small ? 9 : 11);
      setExistingFontSize(options, ['scales', 'r', 'pointLabels'], small ? 10 : 12);

      chart.resize();
      chart.update('none');
    };

    const handleOrientationChange = () => {
      window.setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    window.visualViewport?.addEventListener('resize', handleResize);

    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className={className}>
      <canvas className={chartClassName} ref={canvasRef} />
    </div>
  );
}
