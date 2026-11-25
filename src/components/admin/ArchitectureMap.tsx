import React from 'react';

// বাংলা মন্তব্য: project-analysis-and-suggestions_(3) থেকে সংগৃহীত ভেক্টর টপোলজি মেশ ম্যাপ।
// এটি ক্লায়েন্ট, এজ-গেটওয়ে, রানটাইম সার্ভিসেস এবং স্টেট প্লেনের ইন্টারকানেকশন চমৎকারভাবে প্রদর্শন করে।
export const ArchitectureMap: React.FC = () => {
  const Node = ({
    x,
    y,
    w,
    h,
    label,
    sub,
    tone = 'emerald',
    dashed = false,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    sub?: string;
    tone?: 'emerald' | 'amber' | 'sky' | 'violet' | 'rose';
    dashed?: boolean;
  }) => {
    const stroke = {
      emerald: 'rgba(110,231,183,0.32)',
      amber: 'rgba(245,196,81,0.42)',
      sky: 'rgba(125,211,252,0.32)',
      violet: 'rgba(180,160,255,0.32)',
      rose: 'rgba(255,122,122,0.4)',
    }[tone];
    const fill = {
      emerald: 'rgba(110,231,183,0.055)',
      amber: 'rgba(245,196,81,0.075)',
      sky: 'rgba(125,211,252,0.055)',
      violet: 'rgba(180,160,255,0.055)',
      rose: 'rgba(255,122,122,0.06)',
    }[tone];
    const dot = {
      emerald: '#6ee7b7',
      amber: '#f5c451',
      sky: '#7dd3fc',
      violet: '#b4a0ff',
      rose: '#ff7a7a',
    }[tone];

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="7"
          fill={fill}
          stroke={stroke}
          strokeDasharray={dashed ? '4 4' : undefined}
        />
        <circle cx={x + 12} cy={y + h / 2} r="2.5" fill={dot} />
        <text
          x={x + 22}
          y={y + (sub ? h / 2 - 3 : h / 2 + 3)}
          fill="#e9eef4"
          fontSize="9.6"
          fontFamily="system-ui, sans-serif"
          fontWeight="600"
        >
          {label}
        </text>
        {sub && (
          <text
            x={x + 22}
            y={y + h / 2 + 9}
            fill="rgba(233,238,244,0.45)"
            fontSize="7.4"
            fontFamily="monospace"
          >
            {sub}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="w-full max-w-full overflow-x-auto thin-scroll p-4 rounded-2xl bg-slate-950 border border-slate-800 shadow-inner">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">
          Live Mesh Architecture & Runtime Topology
        </span>
        <span className="font-mono text-[9px] text-cyan-400 border border-cyan-500/20 bg-cyan-950/40 px-2 py-0.5 rounded-full">
          Vector Graph v3.0
        </span>
      </div>

      <svg
        viewBox="0 0 880 400"
        className="h-auto w-full min-w-[720px]"
        role="img"
        aria-label="SupremeAI live mesh architecture map"
      >
        <defs>
          <marker id="mesh-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(255,255,255,0.22)" />
          </marker>
        </defs>

        <text
          x="20"
          y="20"
          fill="rgba(233,238,244,0.4)"
          fontSize="7.6"
          letterSpacing="1.6"
          fontFamily="monospace"
        >
          CLIENTS
        </text>
        <text
          x="252"
          y="20"
          fill="rgba(233,238,244,0.4)"
          fontSize="7.6"
          letterSpacing="1.6"
          fontFamily="monospace"
        >
          EDGE + GATEWAY
        </text>
        <text
          x="540"
          y="20"
          fill="rgba(233,238,244,0.4)"
          fontSize="7.6"
          letterSpacing="1.6"
          fontFamily="monospace"
        >
          RUNTIME SERVICES
        </text>

        {/* Clients */}
        <Node x={20} y={40} w={160} h={42} label="Studio Web" sub="React 19 · Pages" />
        <Node x={20} y={94} w={160} h={42} label="Desktop" sub="Tauri v2 · Windows" />
        <Node x={20} y={148} w={160} h={42} label="Android" sub="Tauri mobile · APK" />
        <Node x={20} y={202} w={160} h={42} label="VS Code" sub="Realtime channel" tone="violet" />

        {/* Gateway */}
        <Node
          x={252}
          y={64}
          w={196}
          h={46}
          label="Gateway Entry"
          sub="FastAPI · OpenAI-compatible"
          tone="sky"
        />
        <Node
          x={252}
          y={122}
          w={196}
          h={46}
          label="Gateway Arbiter"
          sub="routing · policy · auth"
          tone="sky"
        />
        <Node
          x={252}
          y={190}
          w={196}
          h={42}
          label="Cloudflare Edge"
          sub="Pages · Functions · CSP"
        />

        {/* Runtime */}
        <Node x={540} y={40} w={170} h={40} label="Core API" sub="primary node" />
        <Node x={540} y={90} w={170} h={40} label="Worker" sub="async worker node" />
        <Node x={540} y={140} w={170} h={40} label="Scraper" sub="browser relay node" />
        <Node x={540} y={190} w={170} h={40} label="Tiny Brain" sub="micro-AI brain node" />
        <Node
          x={540}
          y={252}
          w={170}
          h={42}
          label="MCP Control Tower"
          sub="live telemetry & tools"
          tone="amber"
        />
        <Node
          x={540}
          y={306}
          w={170}
          h={40}
          label="Federation Bridge"
          sub="claims · patches · feedback"
          tone="violet"
        />
        <Node x={754} y={252} w={106} h={42} label="28 tools" sub="MCP surface" tone="amber" />
        <Node x={754} y={306} w={106} h={40} label="Agents" sub="heartbeats" tone="violet" />

        {/* Connecting Edges */}
        <path
          d="M180 61 C215 61 218 83 252 86"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M180 115 C215 115 218 110 252 108"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M180 169 C217 169 216 137 252 139"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M180 223 C218 223 217 146 252 145"
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="3 3"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M350 110 L350 122"
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M448 145 C480 145 490 60 540 60"
          fill="none"
          stroke="rgba(110,231,183,0.3)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M448 145 C480 145 492 110 540 110"
          fill="none"
          stroke="rgba(110,231,183,0.3)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M448 150 C490 155 500 160 540 160"
          fill="none"
          stroke="rgba(110,231,183,0.3)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M448 152 C486 170 500 200 540 208"
          fill="none"
          stroke="rgba(110,231,183,0.25)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M350 168 L350 190"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          markerEnd="url(#mesh-arrow)"
        />
        <path
          d="M448 210 C486 210 500 268 540 272"
          fill="none"
          stroke="rgba(245,196,81,0.35)"
          strokeDasharray="4 4"
          markerEnd="url(#mesh-arrow)"
        />
        <path d="M625 294 L625 306" fill="none" stroke="rgba(255,255,255,0.2)" />
        <path
          d="M710 273 L754 273"
          fill="none"
          stroke="rgba(245,196,81,0.35)"
          strokeDasharray="4 4"
        />
        <path
          d="M710 326 L754 326"
          fill="none"
          stroke="rgba(180,160,255,0.35)"
          strokeDasharray="4 4"
        />

        {/* State Plane */}
        <g transform="translate(20,270)">
          <text
            x="0"
            y="0"
            fill="rgba(233,238,244,0.4)"
            fontSize="7.6"
            letterSpacing="1.6"
            fontFamily="monospace"
          >
            STATE + EXTERNAL PLANE
          </text>
          <rect
            x="0"
            y="12"
            width="140"
            height="38"
            rx="7"
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.12)"
          />
          <text x="12" y="29" fill="#e9eef4" fontSize="9" fontWeight="600">
            Supabase
          </text>
          <text x="12" y="41" fill="rgba(233,238,244,0.4)" fontSize="7.2" fontFamily="monospace">
            154 tables · postgres
          </text>

          <rect
            x="152"
            y="12"
            width="140"
            height="38"
            rx="7"
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.12)"
          />
          <text x="164" y="29" fill="#e9eef4" fontSize="9" fontWeight="600">
            Upstash Redis
          </text>
          <text
            x="164"
            y="41"
            fill="rgba(233,238,244,0.4)"
            fontSize="7.2"
            fontFamily="monospace"
          >
            Active: secondary
          </text>

          <rect
            x="304"
            y="12"
            width="140"
            height="38"
            rx="7"
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.12)"
          />
          <text x="316" y="29" fill="#e9eef4" fontSize="9" fontWeight="600">
            Infisical
          </text>
          <text
            x="316"
            y="41"
            fill="rgba(233,238,244,0.4)"
            fontSize="7.2"
            fontFamily="monospace"
          >
            4/4 core secrets
          </text>
        </g>

        {/* Legend */}
        <g transform="translate(20,352)">
          <circle cx="3" cy="3" r="2.5" fill="#6ee7b7" />
          <text x="12" y="6" fill="rgba(233,238,244,0.4)" fontSize="7.4" fontFamily="monospace">
            healthy
          </text>
          <circle cx="78" cy="3" r="2.5" fill="#f5c451" />
          <text x="87" y="6" fill="rgba(233,238,244,0.4)" fontSize="7.4" fontFamily="monospace">
            degraded
          </text>
          <circle cx="158" cy="3" r="2.5" fill="#b4a0ff" />
          <text x="167" y="6" fill="rgba(233,238,244,0.4)" fontSize="7.4" fontFamily="monospace">
            control plane
          </text>
          <text
            x="620"
            y="6"
            fill="rgba(110,231,183,0.7)"
            fontSize="7.4"
            fontFamily="monospace"
          >
            Render fleet: 6 services deploying to main
          </text>
        </g>
      </svg>
    </div>
  );
};

export interface RadarDataPoint {
  label: string;
  value: number;
}

// বাংলা মন্তব্য: 8-ডোমেন অডিট স্কোরের ইন্টারঅ্যাক্টিভ রেডিয়াল রাডার চার্ট (SVG)
export const AuditRadarChart: React.FC<{
  data: RadarDataPoint[];
  width?: number;
  height?: number;
}> = ({ data, width = 360, height = 290 }) => {
  const cx = width / 2;
  const cy = height / 2 + 5;
  const R = Math.min(width, height) * 0.32;
  const n = data.length;

  const pt = (i: number, radius: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };

  const points = data
    .map((d, i) => {
      const clamped = Math.max(0, Math.min(100, d.value));
      const [x, y] = pt(i, (clamped / 100) * R);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="w-full flex items-center justify-center overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto max-w-full"
        role="img"
        aria-label="Multi-domain score radar"
      >
        <defs>
          <linearGradient id="auditRadarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* Concentric grid rings */}
        {[0.25, 0.5, 0.75, 1.0].map((k) => (
          <polygon
            key={k}
            points={Array.from({ length: n }, (_, i) => {
              const [x, y] = pt(i, R * k);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ')}
            fill="none"
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-800"
            strokeWidth="1"
            strokeDasharray={k < 1.0 ? '3 3' : undefined}
          />
        ))}

        {/* Radial Spokes */}
        {Array.from({ length: n }).map((_, i) => {
          const [x, y] = pt(i, R);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
              strokeWidth="1"
            />
          );
        })}

        {/* Radar Value Polygon */}
        <polygon
          points={points}
          fill="url(#auditRadarGrad)"
          stroke="#06b6d4"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Point Dots */}
        {data.map((d, i) => {
          const clamped = Math.max(0, Math.min(100, d.value));
          const [x, y] = pt(i, (clamped / 100) * R);
          return (
            <circle
              key={d.label}
              cx={x}
              cy={y}
              r="3.5"
              fill="#06b6d4"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
          );
        })}

        {/* Dimension Labels */}
        {data.map((d, i) => {
          const [x, y] = pt(i, R + 22);
          const anchor = Math.abs(x - cx) < 15 ? 'middle' : x > cx ? 'start' : 'end';
          return (
            <text
              key={d.label}
              x={x}
              y={y + 3}
              textAnchor={anchor}
              fill="currentColor"
              className="text-[9px] font-mono fill-slate-500 dark:fill-slate-400 select-none"
            >
              {d.label.toUpperCase()} ({d.value})
            </text>
          );
        })}
      </svg>
    </div>
  );
};
