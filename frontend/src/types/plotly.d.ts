/** plotly.js-dist-min の最小型宣言（strict TypeScript 用）。 */

declare module 'plotly.js-dist-min' {
  export interface PlotlyTrace {
    type?: string;
    mode?: string;
    name?: string;
    x?: number[];
    y?: number[];
    xaxis?: string;
    yaxis?: string;
    line?: {
      color?: string;
      width?: number;
      dash?: string;
    };
    marker?: {
      color?: string;
      size?: number;
      symbol?: string;
    };
    fill?: string;
    fillcolor?: string;
    hovertemplate?: string;
    showlegend?: boolean;
  }

  export interface PlotlyShape {
    type?: string;
    x0?: number;
    x1?: number;
    y0?: number;
    y1?: number;
    xref?: string;
    yref?: string;
    line?: {
      color?: string;
      width?: number;
      dash?: string;
    };
  }

  export interface PlotlyLayout {
    title?: string | { text?: string; font?: { size?: number } };
    margin?: { l?: number; r?: number; t?: number; b?: number };
    autosize?: boolean;
    height?: number;
    showlegend?: boolean;
    legend?: Record<string, unknown>;
    hovermode?: string;
    paper_bgcolor?: string;
    plot_bgcolor?: string;
    xaxis?: Record<string, unknown>;
    yaxis?: Record<string, unknown>;
    xaxis2?: Record<string, unknown>;
    yaxis2?: Record<string, unknown>;
    grid?: Record<string, unknown>;
    shapes?: PlotlyShape[];
    annotations?: Record<string, unknown>[];
  }

  export interface PlotlyConfig {
    responsive?: boolean;
    displaylogo?: boolean;
    displayModeBar?: boolean;
    modeBarButtonsToRemove?: string[];
  }

  export interface PlotlyHTMLElement extends HTMLElement {
    on?: (eventName: string, handler: (eventData: { points?: Array<{ x?: number }> }) => void) => void;
    removeAllListeners?: (eventName: string) => void;
  }

  export function react(
    root: HTMLElement,
    data: PlotlyTrace[],
    layout?: PlotlyLayout,
    config?: PlotlyConfig
  ): Promise<PlotlyHTMLElement>;

  export function purge(root: HTMLElement): void;

  const Plotly: {
    react: typeof react;
    purge: typeof purge;
  };

  export default Plotly;
}
