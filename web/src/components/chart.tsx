"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = { present: "#10b981", leave: "#8b5cf6", absent: "#f43f5e", late: "#f59e0b" };

export function TrendChart({ data }: { data: { date: string; present: number; late: number; absent: number; leave: number }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="22%">
          <defs>
            {Object.entries(COLORS).map(([k, c]) => (
              <linearGradient key={k} id={`trend-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c} />
                <stop offset="1" stopColor={c} stopOpacity={0.55} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#eef0f4" strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={12} tick={{ fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} fontSize={12} tick={{ fill: "#64748b" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip cursor={{ fill: "#eef2ff", radius: 6 }} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 8px 24px -8px rgba(15,23,42,0.2)" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="present" stackId="a" fill="url(#trend-present)" name="Present" />
          <Bar dataKey="leave" stackId="a" fill="url(#trend-leave)" name="Leave" />
          <Bar dataKey="absent" stackId="a" fill="url(#trend-absent)" name="Absent" radius={[5, 5, 0, 0]} />
          <Bar dataKey="late" fill="url(#trend-late)" name="Late" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
