import { ChartComponent } from './Chart';
import dragDataPlugin from 'chartjs-plugin-dragdata';
import {
  Chart,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

// Radar-specific Chart.js pieces plus drag support.
// Chart.register() is safe to call here because this module is the only place
// that needs chartjs-plugin-dragdata.
Chart.register(
  dragDataPlugin,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
);

const datasetNames = [
  'Bean Flavour',
  'Intended Cup Flavour',
  'Archetype Tendency',
  'Predicted Flavour',
];

const beanDatasetDefaults = {
  label: 'Bean Flavour',
  borderColor: 'rgb(45, 156, 87)',
  fill: true,
  backgroundColor: 'rgba(45, 156, 87, 0.1)',
  borderWidth: 2,
  pointStyle: false,
};

const intendedDatasetDefaults = {
  label: 'Intended Cup Flavour',
  borderColor: 'rgb(28, 91, 94)',
  fill: true,
  backgroundColor: 'rgba(28, 91, 94, 0.1)',
  borderWidth: 2,
  pointStyle: false,
};

const archetypeDatasetDefaults = {
  label: 'Archetype Tendency',
  borderColor: 'rgb(170, 149, 90)',
  fill: false,
  borderWidth: 2,
  pointStyle: false,
  borderDash: [6, 6],
};

const predictedDatasetDefaults = {
  label: 'Predicted Flavour',
  borderColor: 'rgb(114, 93, 47)',
  fill: true,
  backgroundColor: 'rgba(114, 93, 47, 0.2)',
  borderWidth: 2,
  pointStyle: false,
};

function isSmallScreen() {
  return typeof window !== 'undefined' && window.innerWidth < 640;
}

function makeRadarChartData(data, onDragEnd = null) {
  const small = isSmallScreen();

  return {
    type: 'radar',
    data: {
      labels: data.labels,
      datasets: [
        { ...beanDatasetDefaults, data: data.beanFlavour },
        { ...intendedDatasetDefaults, data: data.intendedCupFlavour },
        { ...archetypeDatasetDefaults, data: data.archetypeTendency },
        { ...predictedDatasetDefaults, data: data.predictedFlavour },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animations: false,
      interaction: {
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          display: true,
          labels: {
            padding: 8,
            font: {
              size: small ? 10 : 12,
            },
            generateLabels(chart) {
              const original = Chart.defaults.plugins.legend.labels.generateLabels;
              const labels = original.call(this, chart);

              labels.forEach((label, index) => {
                const dataset = chart.data.datasets[index];
                label.lineWidth = 3;
                if (dataset?.borderDash?.length) {
                  label.lineDash = dataset.borderDash;
                }
              });

              return labels;
            },
          },
        },
        dragData: {
          round: 1,
          showTooltip: true,
          onDragStart(_event, datasetIndex) {
            return datasetIndex === 0 || datasetIndex === 1;
          },
          onDrag(_event, datasetIndex) {
            return datasetIndex === 0 || datasetIndex === 1;
          },
          onDragEnd(_event, datasetIndex, index, value) {
            if (datasetIndex !== 0 && datasetIndex !== 1) return;

            onDragEnd?.({
              label: data.labels[index],
              dataset: datasetNames[datasetIndex],
              value,
              datasetIndex,
              index,
            });
          },
        },
      },
      scales: {
        r: {
          type: 'radialLinear',
          beginAtZero: true,
          min: 0,
          max: 10,
          grid: {
            circular: true,
            color: 'rgb(128,128,128)',
            borderWidth: 1,
          },
          angleLines: {
            color: 'rgb(128,128,128)',
          },
          ticks: {
            stepSize: 1,
            backdropColor: 'transparent',
            font: {
              size: small ? 9 : 11,
            },
            callback(value) {
              return value === 0 || value === 5 || value === 10 ? value : '';
            },
          },
          pointLabels: {
            font: {
              size: small ? 10 : 12,
              weight: 500,
            },
            color: 'rgb(128,128,128)',
          },
        },
      },
    },
  };
}

export function ExtendedRadarChart({
  data,
  onDragEnd = null,
  className = 'max-h-36 w-full',
}) {
  return (
    <ChartComponent
      className="max-w-full flex-shrink flex-grow"
      chartClassName={className}
      data={makeRadarChartData(data, onDragEnd)}
    />
  );
}
