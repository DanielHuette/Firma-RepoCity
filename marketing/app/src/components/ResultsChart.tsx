// Daily reads and clicks of a campaign as a line chart.
import { CategoryScale, Chart, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { useEffect, useRef } from "preact/hooks";
import type { DayRow } from "../lib/results";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip, Filler);

export function ResultsChart({ rows }: { rows: DayRow[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current === null) return;
    const chart = new Chart(canvas.current, {
      type: "line",
      data: {
        labels: rows.map((row) => new Date(`${row.day}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })),
        datasets: [
          { label: "Aufrufe", data: rows.map((row) => row.views), borderColor: "#dcb25c", backgroundColor: "rgba(220,178,92,0.10)", fill: true, tension: 0.3, yAxisID: "y" },
          { label: "Klicks", data: rows.map((row) => row.clicks), borderColor: "#8fb0ff", backgroundColor: "#8fb0ff", tension: 0.3, yAxisID: "y2" },
          { label: "Anfragen", data: rows.map((row) => row.leads), borderColor: "#5fcf8a", backgroundColor: "#5fcf8a", tension: 0.3, yAxisID: "y2", borderDash: [4, 4] },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, color: "#a9a79f", font: { family: "Archivo" } } } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Aufrufe", color: "#a9a79f" }, ticks: { color: "#a9a79f" }, grid: { color: "rgba(243,241,234,0.1)" } },
          y2: { beginAtZero: true, position: "right", title: { display: true, text: "Klicks, Anfragen", color: "#a9a79f" }, ticks: { color: "#a9a79f" }, grid: { display: false } },
          x: { ticks: { color: "#a9a79f" }, grid: { display: false } },
        },
      },
    });
    return () => {
      chart.destroy();
    };
  }, [rows]);
  return (
    <div class="chart">
      <canvas ref={canvas} role="img" aria-label="Aufrufe, Klicks und Anfragen je Tag" />
    </div>
  );
}
